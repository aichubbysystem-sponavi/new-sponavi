/**
 * POST /api/pmax/sync
 * 全店舗のP-MAXデータを一括取得→DB保存
 * body: { month: "YYYY-MM", forceFullScan?: boolean }
 *
 * 最適化: pmax_account_mappingにP-MAXキャンペーンがあるアカウントを記録
 * 初回: 全アカウントスキャン（~293回）→マッピング保存
 * 2回目以降: マッピング済みアカウントのみ（~50回）
 * forceFullScan=true で全アカウント再スキャン
 */
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import {
  listAccounts,
  getCampaignMonthly,
  parseCampaignName,
} from "@/lib/google-ads";
import { getGbpRowStrict } from "@/lib/pmax-sheet";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const delays = [3000, 8000, 15000];
  for (let i = 0; i <= delays.length; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if ((msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) && i < delays.length) {
        console.log(`[pmax/sync] ${label} 429 retry ${i + 1}, wait ${delays[i]}ms`);
        await new Promise(r => setTimeout(r, delays[i]));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}

type ParsedRow = {
  shopName: string;
  language: string;
  accountId: string;
  campaignName: string;
  campaignId: string;
  month?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  averageCpc: number;
  costMicros: number;
};

export const POST = withAudit("P-MAX広告データ同期", "PAID_OP", async (request, ctx) => {
  let body: { month?: string; forceFullScan?: boolean; shopNames?: string[] };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "不正なリクエスト" }, { status: 400 }); }

  const { month, forceFullScan, shopNames: selectedShops } = body;
  const isSelectiveSync = Array.isArray(selectedShops) && selectedShops.length > 0;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: "month は YYYY-MM 形式" }, { status: 400 });
  }

  ctx.detail = `対象月${month}${isSelectiveSync ? `、選択${selectedShops.length}店舗` : forceFullScan ? "、フルスキャン" : ""}`;

  const [, monthStr] = month.split("-");
  const year = Number(month.split("-")[0]);
  const mon = Number(monthStr);
  const startDate = `${month}-01`;
  const lastDay = new Date(year, mon, 0).getDate();
  const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

  const sb = getSupabase();

  try {

  // ── Step 1: 対象アカウントを決定 ──
  let targetAccountIds: string[] = [];
  let isFullScan = false;

  if (isSelectiveSync) {
    // 選択店舗のアカウントだけ取得
    const { data: mappings } = await sb
      .from("pmax_account_mapping")
      .select("account_id, shop_name")
      .limit(5000);

    if (mappings && mappings.length > 0) {
      const selectedSet = new Set(selectedShops);
      const filtered = mappings.filter((m: { shop_name: string }) => selectedSet.has(m.shop_name));
      targetAccountIds = Array.from(new Set(filtered.map((m: { account_id: string }) => m.account_id)));
      console.log(`[pmax/sync] Selective sync: ${selectedShops.length} shops → ${targetAccountIds.length} accounts`);
    }
    if (targetAccountIds.length === 0) {
      return NextResponse.json({ error: "選択した店舗のアカウントマッピングが見つかりません。先に全店舗同期を実行してください。" }, { status: 400 });
    }
  } else if (!forceFullScan) {
    // DBからマッピング済みアカウントIDを取得
    const { data: mappings } = await sb
      .from("pmax_account_mapping")
      .select("account_id")
      .limit(1000);

    if (mappings && mappings.length > 0) {
      targetAccountIds = Array.from(new Set(mappings.map((m: { account_id: string }) => m.account_id)));
      console.log(`[pmax/sync] Using cached mapping: ${targetAccountIds.length} accounts (skip full scan)`);
    }
  }

  if (!isSelectiveSync && targetAccountIds.length === 0) {
    // マッピングなし or forceFullScan → 全アカウントスキャン
    isFullScan = true;
    const accounts = await withRetry(() => listAccounts(), "listAccounts");
    targetAccountIds = accounts.map(a => a.customerId);
    console.log(`[pmax/sync] Full scan: ${targetAccountIds.length} accounts`);
  }

  // ── Step 2: 月次データ取得 ──
  const allMonthly: ParsedRow[] = [];
  const BATCH = 15;

  for (let i = 0; i < targetAccountIds.length; i += BATCH) {
    const batch = targetAccountIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (accId) => {
        const m = await withRetry(
          () => getCampaignMonthly(accId, startDate, endDate),
          `m:${accId}`
        ).catch(() => []);
        return { accountId: accId, monthly: m };
      })
    );
    for (const res of results) {
      if (res.status !== "fulfilled") continue;
      for (const c of res.value.monthly) {
        const parsed = parseCampaignName(c.campaignName);
        allMonthly.push({ ...c, shopName: parsed.shopName, language: parsed.language, accountId: res.value.accountId });
      }
    }
    if (i + BATCH < targetAccountIds.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  console.log(`[pmax/sync] ${allMonthly.length} rows from ${targetAccountIds.length} accounts`);

  // ── Step 3: アカウントマッピング保存（フルスキャン時のみ） ──
  if (isFullScan && allMonthly.length > 0) {
    const mappingRows = allMonthly.map(r => ({
      account_id: r.accountId,
      shop_name: r.shopName,
    }));
    // 重複排除
    const seen = new Set<string>();
    const unique = mappingRows.filter(r => {
      const key = `${r.account_id}:${r.shop_name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 既存マッピングを削除して再作成
    await sb.from("pmax_account_mapping").delete().neq("account_id", "");
    for (let j = 0; j < unique.length; j += 100) {
      await sb.from("pmax_account_mapping").insert(unique.slice(j, j + 100));
    }
    console.log(`[pmax/sync] Saved ${unique.length} account→shop mappings`);
  }

  // ── Step 4: DB保存 ──
  // 選択同期: 選択店舗のデータだけ削除 / 全店舗同期: 月全体を削除
  if (isSelectiveSync) {
    const syncedShopNames = Array.from(new Set(allMonthly.map(r => r.shopName)));
    for (const name of syncedShopNames) {
      await sb.from("pmax_store_data").delete().eq("month", month).eq("shop_name", name);
    }
    console.log(`[pmax/sync] Deleted data for ${syncedShopNames.length} shops in month=${month}`);
  } else {
    const { error: deleteError, count: deleteCount } = await sb
      .from("pmax_store_data")
      .delete({ count: "exact" })
      .eq("month", month);
    console.log(`[pmax/sync] Deleted ${deleteCount ?? "?"} rows for month=${month}`, deleteError ? `ERROR: ${deleteError.message}` : "OK");
  }

  const insertErrors: string[] = [];
  if (allMonthly.length > 0) {
    const rows = allMonthly.map(c => ({
      shop_name: c.shopName, language: c.language, month,
      campaign_name: c.campaignName, campaign_id: c.campaignId,
      impressions: c.impressions, clicks: c.clicks, ctr: c.ctr,
      average_cpc: c.averageCpc, cost_micros: c.costMicros,
      account_id: c.accountId, synced_at: new Date().toISOString(),
    }));
    for (let j = 0; j < rows.length; j += 100) {
      const batch = rows.slice(j, j + 100);
      const { error, count: insertedCount } = await sb.from("pmax_store_data").insert(batch, { count: "exact" });
      if (error) {
        console.error(`[pmax/sync] INSERT batch ${j / 100 + 1} failed:`, error.message, error.details, error.hint);
        insertErrors.push(error.message);
      } else {
        console.log(`[pmax/sync] INSERT batch ${j / 100 + 1}: ${insertedCount ?? batch.length} rows OK`);
      }
    }
  }

  // ── Step 5: GBP同期 ──
  // 相互includesの先頭採用による誤マッチを防ぐため、backfillと同じ安全照合(getGbpRowStrict)を使う。
  // 複数候補にマッチする曖昧な店舗は「別店舗の数値を書き込まない」ためスキップし、一覧で返す。
  const gbpMonthKey = `${year}/${String(mon).padStart(2, "0")}`;
  const shopNames = Array.from(new Set(allMonthly.map(r => r.shopName)));
  let gbpSynced = 0;
  const gbpAmbiguous: string[] = [];
  for (const name of shopNames) {
    try {
      const { row, ambiguous } = await getGbpRowStrict(name, gbpMonthKey);
      if (ambiguous) { gbpAmbiguous.push(name); continue; }
      if (row) {
        await sb.from("pmax_gbp_data").upsert({
          shop_name: name, month: gbpMonthKey,
          total_impressions: row.totalImpressions, total_visits: row.totalVisits,
          phone: row.phone, directions: row.directions, website: row.website,
          menu_clicks: row.menuClicks, save_share: row.saveShare,
          reservation: row.reservation,
          synced_at: new Date().toISOString(),
        }, { onConflict: "shop_name,month" });
        gbpSynced++;
      }
    } catch {}
  }

  // ── Step 6: ログ ──
  await sb.from("pmax_sync_log").upsert({
    shop_name: "__all__", month, synced_by: ctx.sub || null,
    synced_at: new Date().toISOString(),
    status: insertErrors.length === 0 ? "success" : "partial",
    message: insertErrors.length > 0 ? insertErrors.slice(0, 3).join("; ") : null,
  }, { onConflict: "shop_name,month" });

  const { count } = await sb.from("pmax_store_data").select("*", { count: "exact", head: true }).eq("month", month);

  ctx.detail = `対象月${month}: ${shopNames.length}店舗 / 広告${allMonthly.length}行 / GBP同期${gbpSynced}件${isFullScan ? "（フルスキャン）" : ""}${isSelectiveSync ? "（選択同期）" : ""}${insertErrors.length > 0 ? ` / 保存エラー${insertErrors.length}件` : ""}`;

  return NextResponse.json({
    success: insertErrors.length === 0,
    shops: shopNames.length,
    monthlyRows: allMonthly.length,
    gbpSynced,
    gbpAmbiguous: gbpAmbiguous.length > 0 ? gbpAmbiguous.sort() : undefined,
    dbCount: count,
    accountsQueried: targetAccountIds.length,
    isFullScan,
    insertErrors: insertErrors.length > 0 ? insertErrors : undefined,
  });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[pmax/sync] Fatal:", msg);
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json({ error: "Google Ads APIの1日の利用上限に達しました。しばらく時間をおいてから再試行してください。" }, { status: 429 });
    }
    return NextResponse.json({ error: `同期失敗: ${msg.slice(0, 300)}` }, { status: 500 });
  }
});
