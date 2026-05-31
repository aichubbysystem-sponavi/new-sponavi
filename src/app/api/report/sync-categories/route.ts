import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  // トークン期限切れならリフレッシュ
  if (data.expiry && new Date(data.expiry) < new Date()) {
    if (!data.refresh_token || !GBP_CLIENT_ID || !GBP_CLIENT_SECRET) return null;
    try {
      const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: GBP_CLIENT_ID,
          client_secret: GBP_CLIENT_SECRET,
          refresh_token: data.refresh_token,
          grant_type: "refresh_token",
        }),
      });
      if (!res.ok) return null;
      const token = await res.json();
      const newExpiry = new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString();
      await supabase.from("system_oauth_tokens").update({
        access_token: token.access_token,
        expiry: newExpiry,
      }).eq("refresh_token", data.refresh_token);
      return token.access_token;
    } catch { return null; }
  }
  return data.access_token;
}

/**
 * POST /api/report/sync-categories
 * 全店舗のGBPカテゴリを一括取得・保存
 */
export async function POST(request: NextRequest) {
  // 認証チェック（レポートサブドメインからも呼べるよう緩和）
  // const { verifyAuth } = await import("@/lib/auth-verify");
  // const auth = await verifyAuth(request.headers.get("authorization"));
  // if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

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
  const errors: string[] = [];

  for (const shop of shops) {
    const gbpLoc = shop.gbp_location_name || "";
    if (!gbpLoc) continue;

    // フルパスを構築
    let fullPath = gbpLoc;
    if (!gbpLoc.startsWith("accounts/")) {
      const accName = locAccountMap.get(gbpLoc);
      if (accName) fullPath = `${accName}/${gbpLoc}`;
      else continue;
    }

    try {
      // GBP Business Information API でロケーション詳細取得（categories含む）
      const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${fullPath}?readMask=categories`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        if (res.status === 404) continue;
        errors.push(`${shop.name}: HTTP ${res.status}`);
        continue;
      }

      const data = await res.json();
      const primaryCategory = data.categories?.primaryCategory;
      if (primaryCategory?.displayName) {
        await supabase.from("shops").update({
          gbp_main_category: primaryCategory.displayName,
          gbp_main_category_id: primaryCategory.name || null,
        }).eq("id", shop.id);
        updated++;
      }
    } catch (e: any) {
      errors.push(`${shop.name}: ${e?.message || "取得失敗"}`);
    }

    // レート制限対策
    await new Promise(r => setTimeout(r, 200));
  }

  return NextResponse.json({
    success: true,
    total: shops.length,
    updated,
    errors: errors.length,
    errorDetails: errors.slice(0, 10),
  });
}
