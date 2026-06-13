import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
  if (!data) return null;
  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token" }),
    });
    if (!res.ok) return data.access_token;
    const t = await res.json();
    await getSupabase().from("system_oauth_tokens").update({
      access_token: t.access_token,
      expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    }).not("account_id", "is", null);
    return t.access_token;
  } catch { return data.access_token; }
}

async function getDefaultOwnerId(): Promise<string> {
  const supabase = getSupabase();
  // 1. ownersテーブルから最初のオーナーを取得
  try {
    const { data } = await supabase.from("owners").select("id").limit(1).maybeSingle();
    if (data?.id) return data.id;
  } catch (e: any) { console.error("[cron/sync-shops] owners table fetch:", e?.message); }
  // 2. 既存shopsからowner_idを推定
  try {
    const { data } = await supabase.from("shops").select("owner_id").not("owner_id", "is", null).limit(1).maybeSingle();
    if (data?.owner_id) return data.owner_id;
  } catch (e: any) { console.error("[cron/sync-shops] shops owner_id lookup:", e?.message); }
  return "";
}

/**
 * GET /api/cron/sync-shops
 * 毎日新店舗を自動検出: 全GBPアカウントのロケーションをスキャン→未登録店舗を自動追加
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
  }

  // owner_id を事前取得
  const ownerId = await getDefaultOwnerId();
  if (!ownerId) {
    console.log("[cron/sync-shops] owner_id not found, skipping");
    return NextResponse.json({ error: "owner_idが見つかりません", added: 0, skipped: 0 }, { status: 200 });
  }

  // 既存店舗のGBPロケーション名を取得
  const { data: existingShops } = await supabase
    .from("shops").select("gbp_location_name").not("gbp_location_name", "is", null);
  const existingNames = new Set((existingShops || []).map(s => s.gbp_location_name));

  // GBPアカウント一覧を取得（Go API経由）
  let accounts: string[] = [];
  try {
    const accRes = await fetch(`${GO_API_URL}/api/gbp/account`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (accRes.ok) {
      const accData = await accRes.json();
      accounts = (accData || []).map((a: any) => a.name || a.account_name).filter(Boolean);
    }
  } catch (e: any) { console.error("[cron/sync-shops] GBP account list fetch:", e?.message); }

  if (accounts.length === 0) {
    // フォールバック: business_groupsから取得
    const { data: groups } = await supabase.from("business_groups").select("gbp_account_name").not("gbp_account_name", "is", null);
    accounts = (groups || []).map(g => g.gbp_account_name).filter(Boolean);
  }

  // 重複排除
  accounts = Array.from(new Set(accounts));

  let added = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const accName of accounts.slice(0, 5)) {
    try {
      // Account Management API でロケーション一覧（ページネーション対応）
      let nextPageToken = "";
      do {
        const url = new URL(`https://mybusinessbusinessinformation.googleapis.com/v1/${accName}/locations`);
        url.searchParams.set("readMask", "name,title,storefrontAddress,phoneNumbers,latlng,categories");
        url.searchParams.set("pageSize", "100");
        if (nextPageToken) url.searchParams.set("pageToken", nextPageToken);

        const listRes = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(15000),
        });

        if (!listRes.ok) {
          errors.push(`${accName}: HTTP ${listRes.status}`);
          break;
        }

        const listData = await listRes.json();
        const locations = listData.locations || [];
        nextPageToken = listData.nextPageToken || "";

        for (const loc of locations) {
          const locName = loc.name || "";
          if (!locName) { skipped++; continue; }

          // 既存店舗のカテゴリを更新（カテゴリ未保存の場合のみ）
          if (existingNames.has(locName) && loc.categories?.primaryCategory?.displayName) {
            try {
              await supabase.from("shops")
                .update({
                  gbp_main_category: loc.categories.primaryCategory.displayName,
                  gbp_main_category_id: loc.categories.primaryCategory.name || null,
                })
                .eq("gbp_location_name", locName)
                .is("gbp_main_category", null);
            } catch (e: any) { console.error("[cron/sync-shops] category update:", e?.message); }
            skipped++;
            continue;
          }
          if (existingNames.has(locName)) { skipped++; continue; }

          try {
            await fetch(`${GO_API_URL}/api/shop`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({
                name: loc.title || locName,
                gbp_location_name: locName,
                gbp_shop_name: loc.title || "",
                owner_id: ownerId,
                state: loc.storefrontAddress?.administrativeArea || "",
                city: loc.storefrontAddress?.locality || "",
                address: (loc.storefrontAddress?.addressLines || []).join(" "),
                phone: loc.phoneNumbers?.primaryPhone || "",
              }),
            });
            added++;
            existingNames.add(locName);
          } catch (e: any) {
            errors.push(`${loc.title || locName}: ${e?.message || "POST失敗"}`);
          }
        }
      } while (nextPageToken);
    } catch (e: any) {
      errors.push(`${accName}: ${e?.message || "取得失敗"}`);
    }
  }

  // ── Step 2: Go API → Supabase shops 同期 ──
  // Go APIの全店舗をSupabaseにもupsertして、ID/住所/カテゴリ等を統一
  let synced = 0;
  let syncErrors = 0;
  try {
    const goRes = await fetch(`${GO_API_URL}/api/shop`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    if (goRes.ok) {
      const goData = await goRes.json();
      const goShops: any[] = Array.isArray(goData) ? goData : [];
      // Supabaseの既存店舗を名前で取得（重複チェック用）
      const { data: sbShops } = await supabase.from("shops").select("id, name, gbp_location_name");
      const sbByName = new Map((sbShops || []).map((s: any) => [s.name, s]));

      for (const gs of goShops) {
        const name = gs.name || gs.Name;
        if (!name) continue;
        const existing = sbByName.get(name);

        try {
          if (existing) {
            // 既存 → Go APIに値がある場合のみ更新（空文字での上書き防止）
            const updateRow: Record<string, any> = {
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
              updateRow.gbp_shop_name = gs.gbp_shop_name || gs.GbpShopName || null;
            }
            await supabase.from("shops").update(updateRow).eq("id", existing.id);
          } else {
            // 新規 → 挿入
            const insertRow: Record<string, any> = {
              id: gs.id || gs.ID || crypto.randomUUID(),
              name,
              owner_id: gs.owner_id || gs.OwnerID || ownerId,
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
        } catch {
          syncErrors++;
        }
      }
    }
  } catch (e: any) {
    console.error("[cron/sync-shops] Go→Supabase sync error:", e?.message);
  }

  console.log(`[cron/sync-shops] added: ${added}, skipped: ${skipped}, synced: ${synced}, syncErrors: ${syncErrors}, accounts: ${accounts.length}`);
  return NextResponse.json({ success: true, added, skipped, synced, syncErrors, accounts: accounts.length, errors: errors.slice(0, 5) });
}
