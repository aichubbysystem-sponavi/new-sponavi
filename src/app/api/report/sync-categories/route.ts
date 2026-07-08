import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * POST /api/report/sync-categories
 * 全店舗のGBPカテゴリを一括取得・保存
 */
export const POST = withAudit("カテゴリ同期", "DATA_OP", async (request, ctx) => {
  const supabase = getSupabase();
  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  // カテゴリ未設定の店舗を取得
  const { data: shops } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .is("gbp_main_category", null)
    .not("gbp_location_name", "is", null);

  if (!shops || shops.length === 0) {
    ctx.detail = "全店舗のカテゴリが設定済み（更新0件）";
    return NextResponse.json({ success: true, message: "全店舗のカテゴリが設定済みです", updated: 0 });
  }

  // GBPアカウント→ロケーション一覧からカテゴリを取得
  let accountsData: any[] = [];
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) accountsData = await res.json();
  } catch {}

  // ロケーション名→アカウント名のマッピング
  const locAccountMap = new Map<string, string>();
  for (const acc of (Array.isArray(accountsData) ? accountsData : [])) {
    const accName = acc.name || acc.accountName || "";
    for (const loc of (acc.locations || [])) {
      const locName = loc.name || "";
      locAccountMap.set(locName, accName);
      locAccountMap.set(`${accName}/${locName}`, accName);
    }
  }

  let updated = 0;
  let skippedNoPath = 0;
  const errors: string[] = [];
  const debug: string[] = [];

  for (const shop of shops) {
    const gbpLoc = shop.gbp_location_name || "";
    if (!gbpLoc) { skippedNoPath++; continue; }

    // フルパスを構築
    let fullPath = gbpLoc;
    if (!gbpLoc.startsWith("accounts/")) {
      const accName = locAccountMap.get(gbpLoc);
      if (accName) fullPath = `${accName}/${gbpLoc}`;
      else { skippedNoPath++; debug.push(`NO_MAP: ${shop.name} | loc=${gbpLoc}`); continue; }
    }

    try {
      // GBP API v1はlocations/{id}形式（accounts/xxx/locations/yyyではない）
      const locPart = fullPath.includes("/locations/") ? fullPath.split("/locations/").pop() : fullPath.replace("locations/", "");
      const url = `https://mybusinessbusinessinformation.googleapis.com/v1/locations/${locPart}?readMask=categories`;
      debug.push(`FETCH: ${shop.name} | url=${url.slice(0, 120)}`);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        debug.push(`HTTP_ERR: ${res.status} | ${errText.slice(0, 100)}`);
        errors.push(`${shop.name}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      debug.push(`RESPONSE: ${JSON.stringify(data).slice(0, 200)}`);
      const primaryCategory = data.categories?.primaryCategory;
      if (primaryCategory?.displayName) {
        await supabase.from("shops").update({
          gbp_main_category: primaryCategory.displayName,
          gbp_main_category_id: primaryCategory.name || null,
        }).eq("id", shop.id);
        updated++;
        debug.push(`SAVED: ${primaryCategory.displayName}`);
      } else {
        debug.push(`NO_CATEGORY in response`);
      }
    } catch (e: any) {
      errors.push(`${shop.name}: ${e?.message || "取得失敗"}`);
      debug.push(`ERROR: ${e?.message}`);
    }

    await new Promise(r => setTimeout(r, 200));
  }

  ctx.detail = `カテゴリ未設定${shops.length}店舗中 ${updated}件更新, スキップ${skippedNoPath}件, エラー${errors.length}件`;
  return NextResponse.json({
    success: true,
    total: shops.length,
    updated,
    skippedNoPath,
    errors: errors.length,
    errorDetails: errors.slice(0, 10),
    debug,
    locMapSize: locAccountMap.size,
  });
});
