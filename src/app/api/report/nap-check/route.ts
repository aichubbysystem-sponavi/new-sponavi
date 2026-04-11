import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry")
    .limit(1)
    .maybeSingle();
  if (!data) return null;

  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;

  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return data.access_token;
    const t = await res.json();
    await supabase.from("system_oauth_tokens").update({
      access_token: t.access_token,
      expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    }).not("account_id", "is", null);
    return t.access_token;
  } catch { return data.access_token; }
}

/** テキスト正規化（Python版clean_textと同等） */
function normalize(text: string): string {
  if (!text) return "";
  // NFKC正規化相当（全角→半角）
  let s = text.normalize("NFKC");
  // ハイフン系統一除去
  s = s.replace(/[\-\u2010-\u2015\u2212\u30FC\uFF0D\uFF70]/g, "");
  // 空白除去
  s = s.replace(/[\s\u3000]+/g, "");
  // 括弧除去
  s = s.replace(/[（）\(\)\[\]【】「」『』]/g, "");
  // 丁目番地号除去
  s = s.replace(/[丁目番地号]/g, "");
  return s.toLowerCase().trim();
}

function normalizePhone(text: string): string {
  if (!text) return "";
  return text.normalize("NFKC").replace(/\D/g, "");
}

/**
 * POST /api/report/nap-check
 * 全店舗（またはshopIds指定）のNAP整合性をGBP APIで一括チェック
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const shopIds: string[] = body.shopIds || [];

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンが見つかりません" }, { status: 500 });
  }

  const supabase = getSupabase();

  // GBP接続済み店舗を取得
  let query = supabase.from("shops")
    .select("id, name, state, city, address, building, phone, gbp_location_name, gbp_shop_name")
    .not("gbp_location_name", "is", null);
  if (shopIds.length > 0) query = query.in("id", shopIds);
  const { data: shops } = await query;

  if (!shops || shops.length === 0) {
    return NextResponse.json({ error: "GBP接続済みの店舗がありません" }, { status: 404 });
  }

  const results: any[] = [];
  let checked = 0;
  let errors = 0;

  for (const shop of shops) {
    if (!shop.gbp_location_name) continue;

    const locationName = shop.gbp_location_name.startsWith("accounts/")
      ? shop.gbp_location_name
      : `accounts/111148362910776147900/${shop.gbp_location_name}`;

    try {
      const res = await fetch(`${GBP_API_BASE}/${locationName}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        errors++;
        results.push({
          shop_id: shop.id, shop_name: shop.name,
          db_name: shop.name, db_address: [shop.state, shop.city, shop.address, shop.building].filter(Boolean).join(""),
          db_phone: shop.phone || "", gbp_name: "", gbp_address: "", gbp_phone: "",
          name_match: false, address_match: false, phone_match: false,
          status: "GBP取得エラー", detail: `API ${res.status}`,
        });
        continue;
      }

      const gbp = await res.json();
      const gbpName = gbp.title || gbp.locationName || "";
      const gbpAddr = gbp.storefrontAddress;
      const gbpAddress = gbpAddr
        ? [gbpAddr.administrativeArea, gbpAddr.locality, ...(gbpAddr.addressLines || [])].filter(Boolean).join("")
        : "";
      const gbpPhone = gbp.phoneNumbers?.primaryPhone || "";

      const dbName = shop.gbp_shop_name || shop.name;
      const dbAddress = [shop.state, shop.city, shop.address, shop.building].filter(Boolean).join("");
      const dbPhone = shop.phone || "";

      const nameMatch = normalize(dbName) === normalize(gbpName);
      const addrMatch = normalize(dbAddress) === normalize(gbpAddress) || normalize(dbAddress).includes(normalize(gbpAddress)) || normalize(gbpAddress).includes(normalize(dbAddress));
      const phoneMatch = normalizePhone(dbPhone) === normalizePhone(gbpPhone);

      const diffs: string[] = [];
      if (!nameMatch) diffs.push("店名不一致");
      if (!addrMatch) diffs.push("住所不一致");
      if (!phoneMatch && dbPhone && gbpPhone) diffs.push("電話番号不一致");

      results.push({
        shop_id: shop.id, shop_name: shop.name,
        db_name: dbName, db_address: dbAddress, db_phone: dbPhone,
        gbp_name: gbpName, gbp_address: gbpAddress, gbp_phone: gbpPhone,
        name_match: nameMatch, address_match: addrMatch, phone_match: phoneMatch,
        status: diffs.length === 0 ? "OK" : diffs.join(" / "),
        detail: diffs.length === 0 ? "" : `DB「${dbName}」vs GBP「${gbpName}」`,
      });

      checked++;
    } catch (e: any) {
      errors++;
      results.push({
        shop_id: shop.id, shop_name: shop.name,
        db_name: shop.name, db_address: "", db_phone: shop.phone || "",
        gbp_name: "", gbp_address: "", gbp_phone: "",
        name_match: false, address_match: false, phone_match: false,
        status: "エラー", detail: e?.message || "",
      });
    }

    // レート制限対策
    if (checked % 10 === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // Supabaseに保存
  const rows = results.map((r) => ({
    id: crypto.randomUUID(),
    shop_id: r.shop_id, shop_name: r.shop_name,
    db_name: r.db_name, db_address: r.db_address, db_phone: r.db_phone,
    gbp_name: r.gbp_name, gbp_address: r.gbp_address, gbp_phone: r.gbp_phone,
    name_match: r.name_match, address_match: r.address_match, phone_match: r.phone_match,
    status: r.status, detail: r.detail,
    checked_at: new Date().toISOString(),
  }));

  // 既存データ削除→再挿入
  if (shopIds.length > 0) {
    await supabase.from("nap_check_results").delete().in("shop_id", shopIds);
  } else {
    await supabase.from("nap_check_results").delete().not("id", "is", null);
  }

  for (let i = 0; i < rows.length; i += 50) {
    await supabase.from("nap_check_results").insert(rows.slice(i, i + 50));
  }

  return NextResponse.json({
    success: true,
    total: shops.length,
    checked,
    errors,
    ok: results.filter((r) => r.status === "OK").length,
    ng: results.filter((r) => r.status !== "OK" && r.status !== "エラー" && r.status !== "GBP取得エラー").length,
    results,
  });
}

/**
 * GET /api/report/nap-check
 * 保存済みNAPチェック結果を取得
 */
export async function GET() {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("nap_check_results")
    .select("*")
    .order("shop_name", { ascending: true });

  return NextResponse.json(data || []);
}
