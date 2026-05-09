import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("name") || "_WHITE 栄店【アンダーバーホワイト】";
  const results: Record<string, any> = { shopName, steps: [] };

  // Step 1: Supabase接続確認
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
    results.steps.push({ step: "supabase_connect", ok: true, url: SUPABASE_URL, hasServiceKey: !!SUPABASE_SERVICE_KEY });

    // Step 2: 完全一致検索
    const { data: exact, error: exactErr } = await supabase
      .from("shops")
      .select("id, name, gbp_location_name")
      .eq("name", shopName)
      .maybeSingle();
    results.steps.push({ step: "exact_match", found: !!exact, data: exact, error: exactErr?.message });

    // Step 3: 部分一致検索
    if (!exact) {
      const simpleName = shopName.replace(/[【】\[\]（）()]/g, " ").replace(/\s+/g, " ").trim();
      const firstWord = simpleName.split(" ")[0];
      const { data: fuzzy, error: fuzzyErr } = await supabase
        .from("shops")
        .select("id, name, gbp_location_name")
        .ilike("name", `%${firstWord}%`)
        .limit(10);
      results.steps.push({
        step: "fuzzy_match",
        searchWord: firstWord,
        found: fuzzy?.length || 0,
        matches: fuzzy?.map(s => ({ id: s.id, name: s.name, loc: s.gbp_location_name })),
        error: fuzzyErr?.message,
      });
    }

    // Step 4: OAuthトークン確認
    try {
      const { getOAuthToken } = await import("@/lib/gbp-token");
      const token = await getOAuthToken();
      results.steps.push({ step: "oauth_token", hasToken: !!token, tokenPrefix: token?.slice(0, 20) + "..." });

      // Step 5: Performance API テスト（トークンがあれば）
      if (token) {
        const shop = exact || (results.steps[2]?.matches?.[0]);
        if (shop?.gbp_location_name) {
          const locPart = shop.gbp_location_name.includes("/")
            ? shop.gbp_location_name.split("/").slice(-2).join("/")
            : shop.gbp_location_name;
          const now = new Date();
          const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          const apiUrl = `https://businessprofileperformance.googleapis.com/v1/${locPart}/searchkeywords/impressions/monthly?monthlyRange.startMonth.year=${prevMonth.getFullYear()}&monthlyRange.startMonth.month=${prevMonth.getMonth() + 1}&monthlyRange.endMonth.year=${prevMonth.getFullYear()}&monthlyRange.endMonth.month=${prevMonth.getMonth() + 1}&pageSize=5`;

          const apiRes = await fetch(apiUrl, {
            headers: { Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(15000),
          });
          const apiText = await apiRes.text();
          results.steps.push({
            step: "performance_api",
            url: apiUrl,
            status: apiRes.status,
            body: apiText.slice(0, 500),
          });
        } else {
          results.steps.push({ step: "performance_api", skipped: true, reason: "no gbp_location_name" });
        }
      }
    } catch (tokenErr: any) {
      results.steps.push({ step: "oauth_token", error: tokenErr?.message });
    }
  } catch (err: any) {
    results.steps.push({ step: "supabase_connect", ok: false, error: err?.message });
  }

  return NextResponse.json(results, { status: 200 });
}
