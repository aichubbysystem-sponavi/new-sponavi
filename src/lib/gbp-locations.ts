/**
 * GBPロケーション一覧の取得（全アカウント・全トークン横断）
 *
 * 【なぜ必要か】
 * 従来は cron/sync-shops が「Go APIのアカウント一覧の先頭5件」だけをスキャンしていた。
 * 実際には接続アカウントから9つのGBPアカウント（ロケーショングループ）が見えており、
 * 4アカウント分が恒常的にスキャン対象外になっていた（2026-08-08 調査で判明）。
 *
 * 【設計方針】
 * - 1つでもトークン/アカウントが失敗しても全体は止めない（errors配列に積んで続行）
 * - ページネーションを必ず最後まで辿る（pageSize=100固定）
 * - ロケーションIDは "locations/XXXX" に正規化（DBの gbp_location_name と同じ形式）
 * - 同じアカウントを複数トークンで重複スキャンしない（GBP APIのクォータ節約）
 * - 外部fetchには必ず cache:"no-store"（Next.js 14のfetchキャッシュ対策。重要ナレッジ参照）
 */

import { getAllOAuthTokens, getOAuthToken } from "@/lib/gbp-token";

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const READ_MASK = "name,title,storefrontAddress,phoneNumbers,latlng,categories";
/** ページネーションの安全上限。同じpageTokenが返り続けた場合の無限ループを防ぐ */
const MAX_PAGES = 100;

export interface GbpLocation {
  /** "locations/XXXX"（DBの gbp_location_name と同形式） */
  locationId: string;
  /** "accounts/YYY/locations/XXXX" */
  fullPath: string;
  accountId: string;
  accountLabel: string;
  title: string;
  state: string;
  city: string;
  address: string;
  postalCode: string;
  phone: string;
  categoryName: string;
  categoryId: string;
  latitude: number | null;
  longitude: number | null;
}

export interface GbpScanResult {
  locations: Map<string, GbpLocation>;
  /** スキャンできたアカウント（accountId → 表示名） */
  scannedAccounts: Map<string, string>;
  /** 取得に失敗したアカウント/トークン。空でなければ「全件見えていない」と判断する */
  errors: string[];
  /** 有効だったOAuthトークンの本数 */
  usableTokens: number;
}

/** "accounts/A/locations/B" でも "locations/B" でも "locations/B" に揃える */
export function toLocationId(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = String(raw).match(/(locations\/[^/]+)\s*$/);
  return m ? m[1] : "";
}

async function fetchJson(url: string, token: string, timeoutMs = 20000): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } catch (e: unknown) {
    return { ok: false, status: 0, body: { error: e instanceof Error ? e.message : String(e) } };
  }
}

interface GbpAccountRef {
  name: string;
  label: string;
  /** "PERSONAL" | "LOCATION_GROUP" | "USER_GROUP" | "ORGANIZATION" */
  type: string;
}

/** 1トークンで見えるGBPアカウント一覧（ページネーション対応） */
async function listAccounts(token: string): Promise<{ accounts: GbpAccountRef[]; error?: string }> {
  const out: GbpAccountRef[] = [];
  let pageToken = "";
  let pages = 0;
  do {
    const u = new URL(ACCOUNTS_API);
    u.searchParams.set("pageSize", "100");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await fetchJson(u.toString(), token);
    if (!r.ok) {
      // 401/403 = そのトークンが失効しているだけ。他のトークンで同じアカウントが見えるので
      // エラーとして表に出すとノイズになる（接続済み5アカウント中4つは古いトークンのまま）
      if (r.status === 401 || r.status === 403) {
        console.log(`[gbp-locations] accounts.list ${r.status}（失効トークンをスキップ）`);
        return { accounts: out };
      }
      return { accounts: out, error: `accounts.list HTTP ${r.status}` };
    }
    for (const a of (r.body.accounts || [])) {
      if (a?.name) out.push({ name: a.name, label: a.accountName || a.name, type: a.type || "" });
    }
    pageToken = r.body.nextPageToken || "";
  } while (pageToken && ++pages < MAX_PAGES);
  if (pageToken) return { accounts: out, error: `accounts.list がページ上限(${MAX_PAGES})に達しました` };
  return { accounts: out };
}

/**
 * アカウントの走査順を決める。
 * - 同じロケーションが複数アカウントから見える場合、先に見た方の gbp_full_path が採用される
 * - 個人アカウント(PERSONAL)より、業務用のロケーショングループを優先する
 *   （個人アカウントのパスが gbp_full_path に入ると、それが「既知アカウント」として
 *     扱われて新規取り込みの安全ガードが無効化されてしまう）
 * - 同順位は name でソートして実行ごとの順序ブレを無くす
 */
function sortAccounts(accounts: GbpAccountRef[]): GbpAccountRef[] {
  const rank = (a: GbpAccountRef) => (a.type === "PERSONAL" ? 1 : 0);
  return [...accounts].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** 1アカウント配下の全ロケーション（ページネーション対応） */
async function listLocations(
  token: string,
  account: GbpAccountRef,
): Promise<{ locations: GbpLocation[]; error?: string; skipped?: boolean }> {
  const out: GbpLocation[] = [];
  let pageToken = "";
  let pages = 0;
  do {
    const u = new URL(`${INFO_API}/${account.name}/locations`);
    u.searchParams.set("readMask", READ_MASK);
    u.searchParams.set("pageSize", "100");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await fetchJson(u.toString(), token);
    if (!r.ok) {
      // 401/403 はこのトークンにこのアカウントの権限が無いだけ。
      // 「スキャン済み」にはせず、別トークンで再試行できるようにする
      if (r.status === 401 || r.status === 403) {
        console.log(`[gbp-locations] ${account.label}: locations.list ${r.status}（別トークンで再試行）`);
        return { locations: out, skipped: true };
      }
      return { locations: out, error: `${account.label}: locations.list HTTP ${r.status}` };
    }
    for (const loc of (r.body.locations || [])) {
      const locationId = toLocationId(loc?.name);
      if (!locationId) continue;
      const addr = loc.storefrontAddress || {};
      out.push({
        locationId,
        fullPath: `${account.name}/${locationId}`,
        accountId: account.name,
        accountLabel: account.label,
        title: typeof loc.title === "string" ? loc.title.normalize("NFC") : "",
        state: addr.administrativeArea || "",
        city: addr.locality || "",
        address: Array.isArray(addr.addressLines) ? addr.addressLines.join(" ") : "",
        postalCode: addr.postalCode || "",
        phone: loc.phoneNumbers?.primaryPhone || "",
        categoryName: loc.categories?.primaryCategory?.displayName || "",
        categoryId: loc.categories?.primaryCategory?.name || "",
        latitude: typeof loc.latlng?.latitude === "number" ? loc.latlng.latitude : null,
        longitude: typeof loc.latlng?.longitude === "number" ? loc.latlng.longitude : null,
      });
    }
    pageToken = r.body.nextPageToken || "";
  } while (pageToken && ++pages < MAX_PAGES);
  if (pageToken) {
    return { locations: out, error: `${account.label}: locations.list がページ上限(${MAX_PAGES})に達しました` };
  }
  return { locations: out };
}

/**
 * 接続済み全Googleアカウントから見える全GBPロケーションを列挙する。
 *
 * 失敗しても例外は投げない。errors が空でない場合は「一部しか見えていない」ので、
 * 呼び出し側は "GBPに無い=削除された" という判定を絶対に行ってはいけない。
 */
export async function scanAllGbpLocations(): Promise<GbpScanResult> {
  const locations = new Map<string, GbpLocation>();
  const scannedAccounts = new Map<string, string>();
  const errors: string[] = [];

  let tokens: string[] = [];
  try {
    tokens = await getAllOAuthTokens();
  } catch (e: unknown) {
    errors.push(`トークン取得失敗: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (tokens.length === 0) {
    // 最後の砦: 単一トークン取得にフォールバック
    const single = await getOAuthToken();
    if (single) tokens = [single];
  }
  if (tokens.length === 0) {
    errors.push("有効なOAuthトークンが1本もありません");
    return { locations, scannedAccounts, errors, usableTokens: 0 };
  }

  let usableTokens = 0;
  // どのトークンからでも一度は「存在が見えた」アカウント（accountId → 表示名）
  const seenAccounts = new Map<string, string>();

  for (const token of tokens) {
    const { accounts, error } = await listAccounts(token);
    if (error) errors.push(error);
    if (accounts.length === 0) continue;
    usableTokens++;

    for (const acc of sortAccounts(accounts)) {
      seenAccounts.set(acc.name, acc.label);
      // 別トークンでスキャン済みのアカウントは再取得しない（クォータ節約）
      if (scannedAccounts.has(acc.name)) continue;
      const { locations: locs, error: locErr, skipped } = await listLocations(token, acc);
      // 途中まで取れた分は活かす
      for (const l of locs) if (!locations.has(l.locationId)) locations.set(l.locationId, l);
      if (locErr) errors.push(locErr);
      // 権限不足(401/403)や取得失敗のアカウントは「完全に見えた」と記録しない
      // → 後続のトークンで再試行される
      if (!locErr && !skipped) scannedAccounts.set(acc.name, acc.label);
    }
  }

  // 全トークンを試しても最後まで一覧を取り切れなかったアカウントは必ずエラーとして返す。
  // ここを黙って通すと「エラー0・完了」と表示されたまま一部の店舗が同期されず、
  // 誰も気づけない（アクセストークンがスキャン中に期限切れした場合に実際に起こる）。
  const unscanned = Array.from(seenAccounts.entries()).filter(([id]) => !scannedAccounts.has(id));
  for (const [, label] of unscanned) {
    errors.push(`GBPアカウント「${label}」のロケーション一覧を取得できませんでした（この配下は今回同期されていません）`);
  }

  return { locations, scannedAccounts, errors, usableTokens };
}
