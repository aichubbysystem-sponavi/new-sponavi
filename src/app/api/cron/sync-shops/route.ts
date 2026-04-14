import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

/**
 * GET /api/cron/sync-shops
 * 毎日新店舗を自動検出: 全GBPアカウントのロケーションをスキャン→未登録店舗を自動追加
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabase();
  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });
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
  } catch {}

  if (accounts.length === 0) {
    // フォールバック: business_groupsから取得
    const { data: groups } = await supabase.from("business_groups").select("gbp_account_name").not("gbp_account_name", "is", null);
    accounts = (groups || []).map(g => g.gbp_account_name).filter(Boolean);
  }

  let added = 0;
  let skipped = 0;

  for (const accName of accounts.slice(0, 5)) {
    try {
      // Account Management API でロケーション一覧
      const listRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${accName}/locations?readMask=name,title,storefrontAddress,phoneNumbers&pageSize=100`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000) }
      );

      if (!listRes.ok) continue;
      const listData = await listRes.json();
      const locations = listData.locations || [];

      for (const loc of locations) {
        const locName = loc.name || "";
        if (!locName || existingNames.has(locName)) { skipped++; continue; }

        // Go API経由で店舗作成
        try {
          await fetch(`${GO_API_URL}/api/shop`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
            body: JSON.stringify({
              name: loc.title || locName,
              gbp_location_name: locName,
              gbp_shop_name: loc.title || "",
              state: loc.storefrontAddress?.administrativeArea || "",
              city: loc.storefrontAddress?.locality || "",
              address: (loc.storefrontAddress?.addressLines || []).join(" "),
              phone: loc.phoneNumbers?.primaryPhone || "",
            }),
          });
          added++;
          existingNames.add(locName);
        } catch {}
      }
    } catch {}
  }

  console.log(`[cron/sync-shops] added: ${added}, skipped: ${skipped}, accounts: ${accounts.length}`);
  return NextResponse.json({ success: true, added, skipped, accounts: accounts.length });
}
