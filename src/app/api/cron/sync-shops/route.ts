import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyCron } from "@/lib/supabase";
import { getOAuthToken } from "@/lib/gbp-token";
import { syncShopsFromGbp } from "@/lib/gbp-shop-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * GET /api/cron/sync-shops
 * 毎日実行:
 *   Step 1) 全GBPアカウントをスキャンし、新店舗を追加 + 既存店舗のGBP店名(gbp_shop_name)を同期
 *   Step 2) Go API → Supabase の店舗情報同期
 *
 * Step 1 の実体は lib/gbp-shop-sync.ts（手動実行の /api/report/gbp-sync と同じロジック）。
 * shops.name は結合キーなので絶対に更新しない。GBP側の改名は gbp_shop_name に入る。
 */
export async function GET(request: NextRequest) {
  const cronErr = verifyCron(request); if (cronErr) return cronErr;

  const supabase = getSupabase();

  let added = 0;
  let skipped = 0;
  let renamed = 0;
  let linked = 0;
  let linkable: string[] = [];
  let pendingInserts: { title: string; accountLabel: string }[] = [];
  let scannedAccounts = 0;
  const errors: string[] = [];
  let defaultGroupId: string | null = null;

  try {
    // autoLink / allowInsert は付けない: 無人実行ではDBに店舗を増やさない・連携を張り直さない。
    // 検出結果は linkable / pendingInserts として返し、登録は人が画面から実行する。
    // （担当者が解除した連携を毎晩復活させたり、新アカウント接続時に数百件が
    //   無言で登録されるのを防ぐ。2026-08-08に254件で顕在化）
    const result = await syncShopsFromGbp();
    scannedAccounts = result.accounts;
    added = result.added.length;
    linked = result.linked.length;
    renamed = result.renamed.length;
    // 「スキャンしたが新規ではなかった」＝既存扱い
    skipped = Math.max(0, result.scanned - result.added.length - result.linked.length);
    errors.push(...result.errors);
    for (const c of result.conflicts) errors.push(`${c.title}: ${c.reason}`);
    linkable = result.linkable;
    pendingInserts = result.pendingInserts;
    if (linkable.length > 0) {
      console.log(`[cron/sync-shops] 紐付け候補（画面から実行すれば連携されます）: ${linkable.join(" / ")}`);
    }
    if (pendingInserts.length > 0) {
      // アカウント別の件数を出す。特定アカウントに偏っていれば状況の変化に気づける
      const byAccount = new Map<string, number>();
      for (const p of pendingInserts) byAccount.set(p.accountLabel, (byAccount.get(p.accountLabel) || 0) + 1);
      const breakdown = Array.from(byAccount.entries()).map(([a, n]) => `${a}:${n}件`).join(" / ");
      console.log(`[cron/sync-shops] 未登録の新店舗 ${pendingInserts.length}件を検出（登録は画面から）— ${breakdown}`);
    }
    if (result.renamed.length > 0) {
      console.log(`[cron/sync-shops] 店名変更を検出: ${result.renamed.map(r => `${r.oldGbpName} → ${r.newGbpName}`).join(" / ")}`);
    }
  } catch (e: unknown) {
    errors.push(`GBP同期失敗: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Step 2 用の business_group_id（Go API側に無い店舗をSupabaseへ入れる際に必要）
  try {
    const { data } = await supabase
      .from("shops").select("business_group_id").not("business_group_id", "is", null).limit(1).maybeSingle();
    defaultGroupId = data?.business_group_id || null;
  } catch (e: unknown) { console.error("[cron/sync-shops] business_group_id fetch:", e instanceof Error ? e.message : e); }

  // ── Step 2: Go API → Supabase shops 同期 ──
  // Go APIの全店舗をSupabaseにもupsertして、ID/住所/カテゴリ等を統一
  let synced = 0;
  let syncErrors = 0;
  try {
    const goToken = await getOAuthToken();
    const goRes = await fetch(`${GO_API_URL}/api/shop`, {
      cache: "no-store" as const,
      headers: goToken ? { Authorization: `Bearer ${goToken}` } : {},
      signal: AbortSignal.timeout(15000),
    });
    if (goRes.ok) {
      const goData = await goRes.json();
      const goShops: import("@/lib/api-types").GoApiShop[] = Array.isArray(goData) ? goData : [];
      // Supabaseの既存店舗を名前で取得（重複チェック用）
      // PostgRESTは1件のselectで最大1000行しか返さないため必ずページングする
      type SbShop = { name: string; id: string; gbp_location_name: string | null };
      const sbShops: SbShop[] = [];
      for (let from = 0; ; from += 1000) {
        const { data: page } = await supabase
          .from("shops").select("id, name, gbp_location_name").order("id").range(from, from + 999);
        const rows = (page || []) as SbShop[];
        sbShops.push(...rows);
        if (rows.length < 1000) break;
      }
      const sbByName = new Map(sbShops.map((s) => [s.name, s]));

      for (const gs of goShops) {
        const name = gs.name || gs.Name;
        if (!name) continue;
        const existing = sbByName.get(name);

        try {
          if (existing) {
            // 既存 → Go APIに値がある場合のみ更新（空文字での上書き防止）
            const updateRow: Record<string, string> = {
              updated_at: new Date().toISOString(),
            };
            const goState = gs.state || gs.State || "";
            const goCity = gs.city || gs.City || "";
            const goAddress = gs.address || gs.Address || "";
            const goPhone = gs.phone || gs.Phone || "";
            const goPostal = gs.postal_code || gs.PostalCode || "";
            if (goState) updateRow.state = goState;
            if (goCity) updateRow.city = goCity;
            if (goAddress) updateRow.address = goAddress;
            if (goPhone) updateRow.phone = goPhone;
            if (goPostal) updateRow.postal_code = goPostal;
            // gbp_location_name はSupabase側が空のときだけGo APIから補完
            const goLocName = gs.gbp_location_name || gs.GbpLocationName || null;
            if (goLocName && !existing.gbp_location_name) {
              updateRow.gbp_location_name = goLocName;
              updateRow.gbp_shop_name = gs.gbp_shop_name || gs.GbpShopName || "";
            }
            await supabase.from("shops").update(updateRow).eq("id", existing.id);
          } else {
            // 新規 → 挿入
            // shops に owner_id カラムは無い（オーナーは business_group_id 経由で解決）。
            // 渡すとINSERTが "column owner_id does not exist" で失敗する
            const insertRow: Record<string, any> = {
              id: gs.id || gs.ID || crypto.randomUUID(),
              name,
              business_group_id: defaultGroupId,
              gbp_location_name: gs.gbp_location_name || gs.GbpLocationName || null,
              gbp_shop_name: gs.gbp_shop_name || gs.GbpShopName || null,
              state: gs.state || gs.State || "",
              city: gs.city || gs.City || "",
              address: gs.address || gs.Address || "",
              phone: gs.phone || gs.Phone || "",
              postal_code: gs.postal_code || gs.PostalCode || "",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            await supabase.from("shops").insert(insertRow);
          }
          synced++;
        } catch (e: unknown) {
          console.error(`[cron/sync-shops] shop sync error (${name}):`, e instanceof Error ? e.message : e);
          syncErrors++;
        }
      }
    }
  } catch (e: any) {
    console.error("[cron/sync-shops] Go→Supabase sync error:", e?.message);
  }

  console.log(`[cron/sync-shops] added: ${added}, linked: ${linked}, renamed: ${renamed}, skipped: ${skipped}, synced: ${synced}, syncErrors: ${syncErrors}, accounts: ${scannedAccounts}`);
  return NextResponse.json({
    success: true,
    added, linked, renamed, skipped, synced, syncErrors,
    accounts: scannedAccounts,
    linkable: linkable.slice(0, 20),
    pendingInsertCount: pendingInserts.length,
    pendingInserts: pendingInserts.slice(0, 20),
    errors: errors.slice(0, 10),
  });
}
