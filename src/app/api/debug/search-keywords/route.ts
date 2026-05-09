import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("name") || "_WHITE 栄店【アンダーバーホワイト】";
  const results: Record<string, any> = { shopName, steps: [] };

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
    results.steps.push({ step: "supabase_connect", ok: true });

    // Step 1: 店舗検索
    const { data: shop } = await supabase
      .from("shops")
      .select("id, name, gbp_location_name")
      .eq("name", shopName)
      .maybeSingle();
    results.steps.push({ step: "shop_lookup", found: !!shop, data: shop });

    // Step 2: トークン取得（Go API経由）
    const { getOAuthToken } = await import("@/lib/gbp-token");
    const token = await getOAuthToken();
    results.steps.push({ step: "oauth_token", hasToken: !!token });

    // Step 3: トークンのスコープ確認
    if (token) {
      try {
        const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${token}`);
        const tokenInfo = await tokenInfoRes.json();
        results.steps.push({ step: "token_info", scope: tokenInfo.scope, expires_in: tokenInfo.expires_in, audience: tokenInfo.aud });
      } catch (e: any) {
        results.steps.push({ step: "token_info", error: e?.message });
      }
    }

    // Step 4: locationのフルパス取得
    if (token && shop?.gbp_location_name) {
      const locName = shop.gbp_location_name; // "locations/XXX"

      // フルパス解決（accounts/YYY/locations/XXX）
      let fullPath = "";
      try {
        const { getLocationMap } = await import("@/lib/gbp-location");
        const locMap = await getLocationMap();
        const mapping = locMap.get(locName);
        if (mapping) fullPath = mapping.fullPath;
        results.steps.push({ step: "resolve_fullpath", locName, fullPath: fullPath || "not found" });
      } catch (e: any) {
        results.steps.push({ step: "resolve_fullpath", error: e?.message });
      }

      // Step 5: Performance API テスト（3パターン試行）
      const patterns = [
        { label: "locations/XXX", path: locName },
        ...(fullPath ? [{ label: "accounts/YYY/locations/XXX", path: fullPath }] : []),
      ];

      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const y = prevMonth.getFullYear();
      const m = prevMonth.getMonth() + 1;

      for (const p of patterns) {
        const apiUrl = `https://businessprofileperformance.googleapis.com/v1/${p.path}/searchkeywords/impressions/monthly?monthlyRange.startMonth.year=${y}&monthlyRange.startMonth.month=${m}&monthlyRange.endMonth.year=${y}&monthlyRange.endMonth.month=${m}&pageSize=5`;
        try {
          const apiRes = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          });
          const apiText = await apiRes.text();
          results.steps.push({
            step: `api_test_${p.label}`,
            url: apiUrl,
            status: apiRes.status,
            body: apiText.slice(0, 500),
          });
          if (apiRes.ok) break; // 成功したらそれ以上試さない
        } catch (e: any) {
          results.steps.push({ step: `api_test_${p.label}`, error: e?.message });
        }
      }

      // Step 6: DB直接リフレッシュでも試す（Go APIトークンと異なる可能性）
      if (GBP_CLIENT_ID && GBP_CLIENT_SECRET) {
        try {
          let refreshToken = "";
          const { data: tokenRow } = await supabase
            .from("system_oauth_tokens")
            .select("refresh_token")
            .limit(1)
            .maybeSingle();
          if (tokenRow) refreshToken = tokenRow.refresh_token;

          if (refreshToken) {
            const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: GBP_CLIENT_ID,
                client_secret: GBP_CLIENT_SECRET,
                refresh_token: refreshToken,
                grant_type: "refresh_token",
              }),
            });
            const refreshData = await refreshRes.json();
            const dbToken = refreshData.access_token;

            if (dbToken && dbToken !== token) {
              const testPath = fullPath || locName;
              const apiUrl2 = `https://businessprofileperformance.googleapis.com/v1/${testPath}/searchkeywords/impressions/monthly?monthlyRange.startMonth.year=${y}&monthlyRange.startMonth.month=${m}&monthlyRange.endMonth.year=${y}&monthlyRange.endMonth.month=${m}&pageSize=5`;
              const apiRes2 = await fetch(apiUrl2, {
                headers: { Authorization: `Bearer ${dbToken}` },
                signal: AbortSignal.timeout(15000),
              });
              const apiText2 = await apiRes2.text();
              results.steps.push({
                step: "api_test_db_token",
                tokenDifferent: true,
                status: apiRes2.status,
                body: apiText2.slice(0, 500),
              });
            } else {
              results.steps.push({ step: "api_test_db_token", tokenDifferent: false, note: "same token as Go API" });
            }
          }
        } catch (e: any) {
          results.steps.push({ step: "api_test_db_token", error: e?.message });
        }
      }
    }
  } catch (err: any) {
    results.steps.push({ step: "fatal", error: err?.message });
  }

  return NextResponse.json(results, { status: 200 });
}
