import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/supabase";
import { getOAuthToken, getAllOAuthTokens } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * POST /api/report/media-urls
 * GBPメディアのリソース名から、今この瞬間に有効な画像URLを取り直す。
 *
 * 背景: GBP Media API が返す googleUrl / thumbnailUrl は永続URLではない
 * （公式ドキュメントに "This URL is not static since it may change over time"）。
 * post_logs.media_url に保存した googleUrl は数日で失効し、lh3.googleusercontent.com が
 * 403 を返すようになる（2026-08-09 実測: 保存済みURLは全パターン403、取り直すと200）。
 * 画像そのものは生きているので、リソース名から都度取り直せば表示できる。
 *
 * 注意: 取り直したURLに =s400 等のサイズサフィックスを付けると 400 になる。そのまま使うこと。
 *
 * さらに: メディアの「リソース名」も永続とは限らない。
 * 2026-08-09 実測: 75件中14件が投稿2日後に 404 になったが、該当ロケーションの
 * メディア一覧には同じ投稿日時の写真が別IDで存在した（Googleが処理過程でIDを付け替える）。
 * そのため 404 のときは、クライアントから貰った投稿日時(hints)を頼りに
 * ロケーションのメディア一覧から同時期の写真を探して代替する。
 */

// 失効するURLなので長くは持てない。同じ画面の再描画でGBPを叩き直さない程度の短いTTL
const TTL_MS = 30 * 60 * 1000;
const MAX_NAMES = 200;
const CONCURRENCY = 8;
const CACHE_LIMIT = 5000;
// 404時の代替探索: 投稿日時とメディアのcreateTimeがこの範囲内なら同じ投稿の写真とみなす。
// post_logs.created_at は投稿直後に書かれるので実際の差は数分だが、時差や再投稿を考慮して広めに取る
const FALLBACK_WINDOW_MS = 36 * 60 * 60 * 1000;
const FALLBACK_LIST_PAGES = 3;

type Entry = { url: string | null; thumb: string | null; at: number };
// Vercelのインスタンス内キャッシュ。インスタンスをまたぐと消えるが、
// 1画面ぶんの解決を何度も繰り返さないためには十分
const cache = new Map<string, Entry>();

// accounts/{id}/locations/{id}/media/{id} 以外は弾く。
// localPosts のリソース名や任意の文字列でGBPのURLを組み立てさせない
const MEDIA_NAME_RE = /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/media\/[A-Za-z0-9_-]+$/;

function pruneCache() {
  if (cache.size <= CACHE_LIMIT) return;
  // 古い順に半分捨てる
  const entries = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at);
  for (const [k] of entries.slice(0, Math.floor(entries.length / 2))) cache.delete(k);
}

type Resolved = { name: string; url: string | null; thumb: string | null };
type Failed = { name: string; status: number; detail?: string };

/**
 * GBPアカウントは本番で15個あり、1本のトークンでは一部ロケーションが見えない。
 * 見えないロケーションのメディアをGETすると 404 が返るため、
 * 「リソース名が付け替わった404」と区別がつかず、写真が永久に表示できなくなる。
 * （2026-08-15: 西口酒場ホームラン accounts/111031567193825395772 で発生）
 * → 401/403/404 のときは他のトークンでも試す。
 *   一度成功したトークンはロケーション単位で覚えて、次回以降は総当たりしない。
 */
const TOKEN_RETRY_STATUSES = [401, 403, 404];
const LOC_TOKEN_TTL_MS = 30 * 60 * 1000;
const locTokenCache = new Map<string, { token: string; at: number }>();

const locationOf = (mediaName: string) => mediaName.split("/media/")[0];

function rememberLocToken(loc: string, token: string) {
  locTokenCache.set(loc, { token, at: Date.now() });
  if (locTokenCache.size > 500) {
    for (const [k, v] of Array.from(locTokenCache.entries())) {
      if (Date.now() - v.at > LOC_TOKEN_TTL_MS) locTokenCache.delete(k);
    }
  }
}

/** そのロケーションで成功実績のあるトークン（無ければnull） */
function knownLocToken(loc: string): string | null {
  const hit = locTokenCache.get(loc);
  return hit && Date.now() - hit.at < LOC_TOKEN_TTL_MS ? hit.token : null;
}

/**
 * 予備トークンの取得は高価（アカウントごとにリフレッシュが走る）ので、
 * 既定トークンで404になったときだけ・1リクエストにつき1回だけ取りに行く。
 * getAllOAuthTokens 自体もインスタンス内で短時間キャッシュする。
 */
const EXTRA_TOKENS_TTL_MS = 10 * 60 * 1000;
let extraTokensCache: { tokens: string[]; at: number } | null = null;

function makeExtraTokenLoader(): () => Promise<string[]> {
  let inflight: Promise<string[]> | null = null;
  return () => {
    if (extraTokensCache && Date.now() - extraTokensCache.at < EXTRA_TOKENS_TTL_MS) {
      return Promise.resolve(extraTokensCache.tokens);
    }
    if (!inflight) {
      inflight = getAllOAuthTokens()
        .then(tokens => { extraTokensCache = { tokens, at: Date.now() }; return tokens; })
        .catch(() => []);
    }
    return inflight;
  };
}

async function resolveOne(
  name: string,
  primaryToken: string,
  loadExtraTokens: () => Promise<string[]>,
  exhaustedLocs: Set<string>,
): Promise<{ ok: true; value: Resolved } | { ok: false; value: Failed }> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { ok: true, value: { name, url: hit.url, thumb: hit.thumb } };
  }

  const loc = locationOf(name);
  const get = async (token: string) => {
    const res = await fetch(`${GBP_API_BASE}/${name}`, {
      // 失効URLを掴み続けないよう必ずno-store
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    return res;
  };

  try {
    const first = knownLocToken(loc) || primaryToken;
    let res = await get(first);
    if (res.ok) { rememberLocToken(loc, first); return await readMedia(name, res); }
    let last = { status: res.status, detail: (await res.text().catch(() => "")).slice(0, 200) };

    // 401/403/404 は「このトークンからは見えない」だけの可能性がある。
    // 全トークンで駄目だったロケーションは総当たりを繰り返さない
    if (TOKEN_RETRY_STATUSES.includes(res.status) && !exhaustedLocs.has(loc)) {
      const extras = (await loadExtraTokens()).filter(t => t && t !== first);
      for (const token of extras) {
        res = await get(token);
        if (res.ok) { rememberLocToken(loc, token); return await readMedia(name, res); }
        last = { status: res.status, detail: (await res.text().catch(() => "")).slice(0, 200) };
        if (!TOKEN_RETRY_STATUSES.includes(res.status)) break;
      }
      if (extras.length > 0) exhaustedLocs.add(loc);
    }
    return { ok: false, value: { name, status: last.status, detail: last.detail } };
  } catch (e: any) {
    return { ok: false, value: { name, status: 0, detail: e?.message?.slice(0, 200) } };
  }
}

async function readMedia(
  name: string,
  res: Response,
): Promise<{ ok: true; value: Resolved } | { ok: false; value: Failed }> {
  try {
    const body = await res.json().catch(() => ({} as any));
    const entry: Entry = {
      url: body.googleUrl || null,
      thumb: body.thumbnailUrl || null,
      at: Date.now(),
    };
    if (!entry.url && !entry.thumb) {
      return { ok: false, value: { name, status: 200, detail: "googleUrl/thumbnailUrlが空" } };
    }
    cache.set(name, entry);
    pruneCache();
    return { ok: true, value: { name, url: entry.url, thumb: entry.thumb } };
  } catch (e: any) {
    return { ok: false, value: { name, status: 0, detail: e?.message?.slice(0, 200) } };
  }
}

export async function POST(request: NextRequest) {
  // 締め切りはリクエスト開始からの経過で測る。
  // トークン取得（Go API 20秒 + DBリフレッシュ15秒）のあとに測り始めると
  // 締め切り45秒 + 個別タイムアウト10秒が上乗せされ、maxDuration(60秒)を超えて
  // 関数ごと落ちる＝全件失敗になる
  const startedAt = Date.now();

  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as any));
  const raw: unknown = body?.names;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "names（配列）が必要です" }, { status: 400 });
  }
  // hints: { リソース名: 投稿日時(ISO) }。404時に同時期のメディアを探すために使う（任意）
  const rawHints = body?.hints && typeof body.hints === "object" ? body.hints : {};

  // 重複除去 + 形式チェック
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const n of raw) {
    if (typeof n !== "string" || seen.has(n)) continue;
    seen.add(n);
    if (MEDIA_NAME_RE.test(n)) valid.push(n);
    else invalid.push(n);
  }

  // 上限超過は黙って切らずに件数を返す（呼び出し側で分割して再送する）
  const truncated = Math.max(0, valid.length - MAX_NAMES);
  const targets = valid.slice(0, MAX_NAMES);

  if (targets.length === 0) {
    return NextResponse.json({ urls: {}, failed: [], invalid, truncated });
  }

  const token = await getOAuthToken();
  if (!token) {
    return NextResponse.json({ error: "GBPのOAuthトークンを取得できませんでした" }, { status: 500 });
  }
  // 既定トークンで見えないロケーション用の予備。404が出るまで取りに行かない
  const loadExtraTokens = makeExtraTokenLoader();
  const exhaustedLocs = new Set<string>();

  const urls: Record<string, { url: string | null; thumb: string | null }> = {};
  const failed: Failed[] = [];

  // GBPが遅いと maxDuration を超えて関数ごと落ち、全件が失敗扱いになる。
  // 締め切りを過ぎたら新しいリクエストを出さず、取れた分だけ返して残りは未処理として報告する。
  // 個別タイムアウト10秒ぶんの余裕を残して maxDuration(60秒) 内に必ず返す
  const deadline = startedAt + 45_000;
  let cursor = 0;
  const skipped: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (cursor < targets.length) {
        const name = targets[cursor++];
        if (Date.now() > deadline) { skipped.push(name); continue; }
        const r = await resolveOne(name, token, loadExtraTokens, exhaustedLocs);
        if (r.ok) urls[r.value.name] = { url: r.value.url, thumb: r.value.thumb };
        else failed.push(r.value);
      }
    }),
  );

  // === 404フォールバック ===
  // リソース名の付け替え（前述）で単体GETが404になった写真を、
  // ロケーションのメディア一覧から「投稿日時が近いもの」で代替する。
  // 対象は 404 かつ投稿日時ヒントがあるものだけ。一覧取得は404が出たロケーション限定。
  const substituted = new Set<string>();
  const fallbackTargets = failed.filter((f) => {
    if (f.status !== 404) return false;
    const h = rawHints[f.name];
    return typeof h === "string" && Number.isFinite(Date.parse(h));
  });
  if (fallbackTargets.length > 0) {
    // 同じ画面の他の写真として既に使われているIDを代替に流用しない
    const requestedNames = new Set(targets);
    const byLocation = new Map<string, { name: string; at: number }[]>();
    for (const f of fallbackTargets) {
      const loc = f.name.split("/media/")[0];
      if (!byLocation.has(loc)) byLocation.set(loc, []);
      byLocation.get(loc)!.push({ name: f.name, at: Date.parse(rawHints[f.name]) });
    }

    for (const [loc, wants] of Array.from(byLocation.entries())) {
      if (Date.now() > deadline) break;
      // 一覧は新しい順で返るため、直近の投稿なら先頭ページで見つかる
      const items: { name: string; createTime?: string; googleUrl?: string; thumbnailUrl?: string }[] = [];
      let pageToken = "";
      // 一覧もロケーションが見えるトークンで叩く（既定トークンだと404になるアカウントがある）
      const listToken = knownLocToken(loc) || token;
      for (let i = 0; i < FALLBACK_LIST_PAGES; i++) {
        if (Date.now() > deadline) break;
        try {
          const res = await fetch(
            `${GBP_API_BASE}/${loc}/media?pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
            { cache: "no-store", headers: { Authorization: `Bearer ${listToken}` }, signal: AbortSignal.timeout(10000) },
          );
          if (!res.ok) break;
          const data = await res.json().catch(() => ({} as any));
          items.push(...(data.mediaItems || []));
          pageToken = data.nextPageToken || "";
          if (!pageToken) break;
        } catch { break; }
      }

      const used = new Set<string>();
      // 各404写真に、投稿日時に最も近い未使用メディアを割り当てる
      for (const w of wants.sort((a, b) => a.at - b.at)) {
        let best: (typeof items)[number] | null = null;
        let bestDiff = FALLBACK_WINDOW_MS;
        for (const item of items) {
          if (!item.name || used.has(item.name) || requestedNames.has(item.name)) continue;
          if (!item.googleUrl && !item.thumbnailUrl) continue;
          const t = Date.parse(item.createTime || "");
          if (!Number.isFinite(t)) continue;
          const diff = Math.abs(t - w.at);
          if (diff <= bestDiff) { bestDiff = diff; best = item; }
        }
        if (!best) continue;
        used.add(best.name);
        const entry: Entry = { url: best.googleUrl || null, thumb: best.thumbnailUrl || null, at: Date.now() };
        // 元のリソース名のキーでキャッシュする（次回リクエストは一覧を叩かずに済む）
        cache.set(w.name, entry);
        urls[w.name] = { url: entry.url, thumb: entry.thumb };
        substituted.add(w.name);
      }
    }
    pruneCache();
    if (substituted.size > 0) {
      console.log(`[media-urls] 404の${substituted.size}/${fallbackTargets.length}件を同時期のメディアで代替した`);
    }
  }

  const stillFailed = failed.filter((f) => !substituted.has(f.name));
  if (stillFailed.length > 0) {
    console.error(`[media-urls] ${stillFailed.length}/${targets.length}件の解決に失敗:`, stillFailed.slice(0, 5));
  }
  if (skipped.length > 0) {
    console.error(`[media-urls] 時間切れで${skipped.length}件を未処理のまま返した`);
  }

  return NextResponse.json({ urls, failed: stillFailed, invalid, truncated, skipped });
}
