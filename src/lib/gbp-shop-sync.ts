/**
 * GBP → shops テーブル同期（店名変更の追従・新店舗の取り込み）
 *
 * 【絶対に守る不変条件】
 * shops.name は「システム全体の結合キー」であり、勝手に書き換えてはいけない。
 *   reviews.shop_name / report_analysis.shop_name / pmax_*.shop_name /
 *   grid_ranking_logs.shop_name / report_display_settings.shop_id /
 *   user_shop_access.shop_name / 投稿用スプレッドシートのB列 …
 * これらは全て shops.name の文字列一致で紐付いている。name を変えると
 * 過去データが行方不明になり、自動投稿は「店舗未登録」で静かに止まる。
 *
 * したがって本モジュールは:
 *   - GBP側の現在の店名は gbp_shop_name に同期する（表示・検索・照合用の別名）
 *   - name は新規INSERT時にしか書かない（既存行のnameは絶対に更新しない）
 *   - 変更は shop_name_changes に記録して人が気づけるようにする
 *
 * 参照: 2026-08-08「ジェルネイル専門 WHITE NAIL 高崎店」が検索で出ない調査
 */

import { getSupabase } from "@/lib/supabase";
import { scanAllGbpLocations, toLocationId } from "@/lib/gbp-locations";
import { isSameShopName } from "@/lib/normalize";

export interface RenameRecord {
  shopId: string;
  shopName: string;
  locationId: string;
  oldGbpName: string;
  newGbpName: string;
}

export interface ConflictRecord {
  locationId: string;
  title: string;
  reason: string;
}

export interface SyncSummary {
  /** GBPから見えたロケーション総数 */
  scanned: number;
  /** スキャンできたGBPアカウント数 */
  accounts: number;
  usableTokens: number;
  /** 新規に追加した店舗 */
  added: string[];
  /** GBP未連携だった既存行にGBP情報を紐付けた店舗 */
  linked: string[];
  /** 紐付け可能だが自動では行わなかった店舗（無人実行時。人が実行すれば紐付く） */
  linkable: string[];
  /** gbp_shop_name 等を更新した件数 */
  updated: number;
  /** GBP側で店名が変わっていた店舗 */
  renamed: RenameRecord[];
  /** 自動処理を見送った件（人の判断が必要） */
  conflicts: ConflictRecord[];
  /** 登録せずに保留した新規店舗（無人実行 or 一括登録ガード） */
  pendingInserts: string[];
  /** 保留した理由。"cron"=無人実行のため / "threshold"=一度に登録する件数が多すぎるため */
  insertBlockedReason: "cron" | "threshold" | null;
  /** 一括登録ガードの閾値 */
  insertThreshold: number;
  /** 取得エラー。空でなければ「GBPを全件見えていない」状態 */
  errors: string[];
}

/**
 * 1回の実行でこの件数を超える新規登録が発生する場合、確認なしでは登録しない。
 *
 * 通常の新規出店は多くて数店舗。数十件が一度に出るのは
 * 「新しいGoogleアカウントを接続した」等、状況が変わった合図であり、
 * そのまま流し込むと顧客マスタが意図しない店舗で膨らむ（2026-08-08に254件で発生）。
 */
export const BULK_INSERT_THRESHOLD = 20;

interface ShopRow {
  id: string;
  name: string;
  gbp_shop_name: string | null;
  gbp_location_name: string | null;
  /** 「ロケーション解除」で外した履歴。入っていれば意図的な解除なので自動で戻さない */
  previous_gbp_location_name: string | null;
  gbp_full_path: string | null;
  gbp_main_category: string | null;
  gbp_main_category_id: string | null;
}

const nfc = (s: string | null | undefined) => (s || "").normalize("NFC");

/** PostgRESTのデフォルト1000行上限を回避して全件取得する */
async function fetchAllShops(): Promise<ShopRow[]> {
  const sb = getSupabase();
  const PAGE = 1000;
  const out: ShopRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("shops")
      .select("id, name, gbp_shop_name, gbp_location_name, previous_gbp_location_name, gbp_full_path, gbp_main_category, gbp_main_category_id")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`shops取得失敗: ${error.message}`);
    const rows = (data || []) as ShopRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * 店名変更の履歴を残す。成功したかどうかを返す。
 *
 * 【重要】これは gbp_shop_name を更新する「前」に呼ぶこと。
 * 先に gbp_shop_name を書いてしまうと、履歴の記録に失敗した場合に差分が消えて
 * 次回以降は二度と変更を検出できない（履歴が永久に取れなくなる）。
 */
async function recordRenames(renames: RenameRecord[]): Promise<{ ok: boolean; message?: string }> {
  if (renames.length === 0) return { ok: true };
  try {
    const sb = getSupabase();
    const { error } = await sb.from("shop_name_changes").insert(
      renames.map(r => ({
        shop_id: r.shopId,
        shop_name: r.shopName,
        location_id: r.locationId,
        old_gbp_name: r.oldGbpName,
        new_gbp_name: r.newGbpName,
      })),
    );
    // 握りつぶさない: テーブル未作成に気づけるようにログに残す（重要ナレッジ）
    if (error) {
      console.error("[gbp-shop-sync] shop_name_changes への記録に失敗:", error.message);
      return { ok: false, message: error.message };
    }
    return { ok: true };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[gbp-shop-sync] shop_name_changes 例外:", message);
    return { ok: false, message };
  }
}

/**
 * GBPをスキャンして shops テーブルへ反映する。
 *
 * @param opts.dryRun trueなら一切書き込まず、差分だけを返す
 * @param opts.importNew falseなら新規店舗の追加を行わない（名前同期のみ）
 */
export async function syncShopsFromGbp(
  opts: {
    dryRun?: boolean;
    importNew?: boolean;
    autoLink?: boolean;
    allowInsert?: boolean;
    confirmBulkImport?: boolean;
  } = {},
): Promise<SyncSummary> {
  const dryRun = opts.dryRun === true;
  const importNew = opts.importNew !== false;
  // 既存店舗へのGBP再紐付けは「人が実行したとき」だけ行う。
  // 無人のcronで自動的に紐付けると、担当者が意図的に外した連携を毎晩復活させてしまう
  const autoLink = opts.autoLink === true;
  // 新規店舗の登録も「人が実行したとき」だけ。cronは検出して報告するに留める
  const allowInsert = opts.allowInsert === true;
  const confirmBulkImport = opts.confirmBulkImport === true;
  const sb = getSupabase();

  const scan = await scanAllGbpLocations();
  const summary: SyncSummary = {
    scanned: scan.locations.size,
    accounts: scan.scannedAccounts.size,
    usableTokens: scan.usableTokens,
    added: [],
    linked: [],
    linkable: [],
    updated: 0,
    renamed: [],
    conflicts: [],
    pendingInserts: [],
    insertBlockedReason: null,
    insertThreshold: BULK_INSERT_THRESHOLD,
    errors: [...scan.errors],
  };

  if (scan.locations.size === 0) {
    summary.errors.push("GBPロケーションが1件も取得できませんでした（トークン失効の可能性）");
    return summary;
  }

  let shops: ShopRow[];
  try {
    shops = await fetchAllShops();
  } catch (e: unknown) {
    summary.errors.push(e instanceof Error ? e.message : String(e));
    return summary;
  }

  // 既存店舗の索引をつくる
  // fetchAllShops は id 順で取得しているため、同一ロケーションに複数行がある場合の
  // 「採用する行」は実行ごとにブレない（毎晩 gbp_shop_name が入れ替わるのを防ぐ）
  const byLocation = new Map<string, ShopRow>();
  const byName = new Map<string, ShopRow>();
  const duplicateLocations = new Map<string, ShopRow[]>();
  for (const s of shops) {
    const loc = toLocationId(s.gbp_location_name);
    if (loc) {
      if (!byLocation.has(loc)) {
        byLocation.set(loc, s);
      } else {
        // 同じGBPロケーションに2件以上の店舗行がある = 過去の重複登録。
        // 口コミ・レポートが両方の店舗名に分散している可能性があるため自動統合はしない
        const list = duplicateLocations.get(loc) || [byLocation.get(loc)!];
        list.push(s);
        duplicateLocations.set(loc, list);
      }
    }
    const n = nfc(s.name);
    if (n && !byName.has(n)) byName.set(n, s);
  }

  // 重複登録を要確認として報告（自動では触らない）
  for (const [loc, rows] of Array.from(duplicateLocations.entries())) {
    const title = nfc(scan.locations.get(loc)?.title || "");
    summary.conflicts.push({
      locationId: loc,
      title: title || rows[0].name,
      reason: `同じGBPロケーションに${rows.length}件の店舗が登録されています（${rows.map(r => r.name).join(" / ")}）。`
        + `口コミ・レポートが分散している可能性があるため統合は手動で判断してください`,
    });
  }

  const renames: RenameRecord[] = [];
  const updates: { id: string; row: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];

  // 新規INSERT用の共通値（既存データから推定）
  let defaultOwnerId = "";
  let defaultGroupId: string | null = null;
  if (importNew) {
    const { data: ownerRow } = await sb.from("owners").select("id").limit(1).maybeSingle();
    defaultOwnerId = ownerRow?.id || "";
    const { data: grpRow } = await sb
      .from("shops").select("business_group_id").not("business_group_id", "is", null).limit(1).maybeSingle();
    defaultGroupId = grpRow?.business_group_id || null;
  }

  // 「既に自社が扱っているGBPアカウント」の集合。
  // 新しいGoogleアカウントを接続した際、その人の個人GBP等が大量に自動登録されるのを防ぐため、
  // 未知のアカウント配下の未登録ロケーションはINSERTせず要確認として報告する。
  const knownAccounts = new Set<string>();
  for (const s of shops) {
    if (s.gbp_full_path) knownAccounts.add(s.gbp_full_path.split("/locations/")[0]);
  }
  try {
    const { data: groups } = await sb
      .from("business_groups").select("gbp_account_name").not("gbp_account_name", "is", null);
    for (const g of (groups || [])) if (g.gbp_account_name) knownAccounts.add(g.gbp_account_name);
  } catch (e: unknown) {
    console.error("[gbp-shop-sync] business_groups取得失敗:", e instanceof Error ? e.message : e);
  }

  for (const loc of Array.from(scan.locations.values())) {
    const title = nfc(loc.title);
    const existing = byLocation.get(loc.locationId);

    if (existing) {
      const row: Record<string, unknown> = {};
      const currentGbpName = nfc(existing.gbp_shop_name);

      if (title && currentGbpName !== title) {
        row.gbp_shop_name = title;
        // 変更前の名前: gbp_shop_name が未設定なら DB の name を「以前の名前」とみなす
        const previous = currentGbpName || nfc(existing.name);
        // 表記ゆれだけ（空白・全角半角・大文字小文字）は「変更」に数えない。
        // 顧客マスタの「店名変更あり」バッジと同じ判定を使う（件数が食い違わないように）
        if (previous && !isSameShopName(previous, title)) {
          renames.push({
            shopId: existing.id, shopName: existing.name, locationId: loc.locationId,
            oldGbpName: previous, newGbpName: title,
          });
        }
      }
      if (existing.gbp_full_path !== loc.fullPath) row.gbp_full_path = loc.fullPath;
      if (loc.categoryName && existing.gbp_main_category !== loc.categoryName) {
        row.gbp_main_category = loc.categoryName;
        row.gbp_main_category_id = loc.categoryId || null;
      }
      // gbp_location_name がフルパス等で入っている場合は正規化して直す
      if (existing.gbp_location_name !== loc.locationId) row.gbp_location_name = loc.locationId;

      if (Object.keys(row).length > 0) {
        row.updated_at = new Date().toISOString();
        updates.push({ id: existing.id, row });
      }
      continue;
    }

    // ── ロケーション未紐付け ──
    if (!importNew) continue;

    const sameName = title ? byName.get(title) : undefined;
    if (sameName) {
      if (!sameName.gbp_location_name) {
        // 同名でGBP未連携の行がある = 連携が欠落した行。
        // ただし「ロケーション解除」で意図的に外した行は自動で戻さない。
        // 解除は担当者の判断なので、毎晩のcronが黙って復活させてはいけない。
        if (sameName.previous_gbp_location_name) {
          summary.conflicts.push({
            locationId: loc.locationId, title,
            reason: "この店舗は過去にロケーション連携を手動で解除しています。"
              + "再連携が必要なら顧客マスタから明示的に設定してください",
          });
          continue;
        }
        if (!autoLink) {
          // cron等の無人実行では自動で紐付けず、候補として報告するだけ
          summary.linkable.push(title);
          continue;
        }
        updates.push({
          id: sameName.id,
          row: {
            gbp_location_name: loc.locationId,
            gbp_shop_name: title,
            gbp_full_path: loc.fullPath,
            gbp_main_category: loc.categoryName || null,
            gbp_main_category_id: loc.categoryId || null,
            updated_at: new Date().toISOString(),
          },
        });
        summary.linked.push(title);
        // 同名のGBPロケーションが複数あった場合に、同じ1行へ2回紐付けてしまうのを防ぐ
        // （後勝ちで片方が黙って消えるため）。以降は下のconflict分岐に落ちる
        sameName.gbp_location_name = loc.locationId;
      } else {
        // 同名だが別ロケーションが既に紐付いている → 人の判断が必要
        summary.conflicts.push({
          locationId: loc.locationId, title,
          reason: `同名の既存店舗が別ロケーション(${sameName.gbp_location_name})に紐付いています`,
        });
      }
      continue;
    }

    if (!title) {
      summary.conflicts.push({ locationId: loc.locationId, title: "(名称なし)", reason: "GBPのtitleが空のため追加できません" });
      continue;
    }
    if (!defaultOwnerId) {
      summary.conflicts.push({ locationId: loc.locationId, title, reason: "オーナーが未登録のため追加できません" });
      continue;
    }
    if (!knownAccounts.has(loc.accountId)) {
      summary.conflicts.push({
        locationId: loc.locationId, title,
        reason: `未登録のGBPアカウント「${loc.accountLabel}」の店舗です。`
          + `自社で管理する店舗であれば顧客マスタから手動で登録してください（誤って個人GBPを取り込まないための安全策）`,
      });
      continue;
    }

    inserts.push({
      name: title,
      owner_id: defaultOwnerId,
      business_group_id: defaultGroupId,
      gbp_location_name: loc.locationId,
      gbp_shop_name: title,
      gbp_full_path: loc.fullPath,
      gbp_main_category: loc.categoryName || null,
      gbp_main_category_id: loc.categoryId || null,
      state: loc.state,
      city: loc.city,
      address: loc.address,
      postal_code: (loc.postalCode || "").replace(/[^0-9]/g, "").slice(0, 7),
      phone: loc.phone,
      gbp_latitude: loc.latitude,
      gbp_longitude: loc.longitude,
    });
    // 同一実行内で同じ名前を2回INSERTしないように予約しておく（UNIQUE(name)違反の防止）
    byName.set(title, { id: "", name: title, gbp_shop_name: title, gbp_location_name: loc.locationId,
      previous_gbp_location_name: null, gbp_full_path: loc.fullPath,
      gbp_main_category: null, gbp_main_category_id: null });
  }

  summary.renamed = renames;

  // ── 新規登録をこの実行で行ってよいか判定 ──
  // 「登録するつもりが無い実行」と「一度に大量すぎる実行」は、書き込まずに一覧で返す。
  const insertNames = inserts.map(r => String(r.name));
  let blockedReason: "cron" | "threshold" | null = null;
  if (insertNames.length > 0) {
    if (!allowInsert) blockedReason = "cron";
    else if (!confirmBulkImport && insertNames.length > BULK_INSERT_THRESHOLD) blockedReason = "threshold";
  }
  if (blockedReason) {
    summary.pendingInserts = insertNames;
    summary.insertBlockedReason = blockedReason;
    inserts.length = 0;
  }

  if (dryRun) {
    summary.updated = updates.length;
    summary.added = insertNames.length > 0 && !blockedReason ? insertNames : [];
    return summary;
  }

  // ── 先に店名変更の履歴を書く ──
  // gbp_shop_name を更新してしまうと次回から差分が消えるので、履歴に残せないうちは
  // 「変更を確定させない」。履歴テーブル未作成のまま同期して28件の履歴を失う、を防ぐ。
  const historyResult = await recordRenames(renames);
  if (!historyResult.ok) {
    const renamedIds = new Set(renames.map(r => r.shopId));
    let deferred = 0;
    for (let i = updates.length - 1; i >= 0; i--) {
      if (!renamedIds.has(updates[i].id)) continue;
      delete updates[i].row.gbp_shop_name;
      deferred++;
      // gbp_shop_name しか無かった更新は丸ごと不要
      const remaining = Object.keys(updates[i].row).filter(k => k !== "updated_at");
      if (remaining.length === 0) updates.splice(i, 1);
    }
    summary.errors.push(
      `店名変更の履歴を保存できませんでした（${historyResult.message}）。`
      + `sql/2026-08-08_shop_name_changes.sql を本番SQL Editorで実行してください。`
      + `履歴を失わないよう、${deferred}件の店名同期は次回に持ち越しました`,
    );
  }

  // ── 書き込み（1件ずつ。失敗しても他を止めない） ──
  const CONCURRENCY = 5;
  for (let i = 0; i < updates.length; i += CONCURRENCY) {
    const batch = updates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(async (u) => {
      const { error } = await sb.from("shops").update(u.row).eq("id", u.id);
      if (error) return `更新失敗(${u.id}): ${error.message}`;
      return null;
    }));
    for (const r of results) {
      if (r) summary.errors.push(r); else summary.updated++;
    }
  }

  for (const row of inserts) {
    const { data, error } = await sb.from("shops").insert(row).select("id, name").maybeSingle();
    if (error) {
      summary.conflicts.push({
        locationId: String(row.gbp_location_name), title: String(row.name),
        reason: `追加失敗: ${error.message}`,
      });
      continue;
    }
    if (data?.name) summary.added.push(data.name);
  }

  return summary;
}
