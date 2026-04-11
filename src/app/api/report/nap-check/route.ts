import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/** テキスト正規化 */
function normalize(text: string): string {
  if (!text) return "";
  let s = text.normalize("NFKC");
  s = s.replace(/[\-\u2010-\u2015\u2212\u30FC\uFF0D\uFF70]/g, "");
  s = s.replace(/[\s\u3000]+/g, "");
  s = s.replace(/[（）\(\)\[\]【】「」『』]/g, "");
  s = s.replace(/[丁目番地号]/g, "");
  return s.toLowerCase().trim();
}

function normalizePhone(text: string): string {
  if (!text) return "";
  return text.normalize("NFKC").replace(/\D/g, "");
}

/**
 * POST /api/report/nap-check
 * Go API経由でGBP location情報を取得し、DB情報と比較
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const authHeader = request.headers.get("authorization") || "";
  const body = await request.json().catch(() => ({}));
  const shopIds: string[] = body.shopIds || [];

  const supabase = getSupabase();

  // 店舗一覧取得
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
    try {
      // Go API経由でGBP location情報を取得（basic-infoページと同じエンドポイント）
      const res = await fetch(`${GO_API_URL}/api/shop/${shop.id}/location`, {
        headers: { Authorization: authHeader },
        signal: AbortSignal.timeout(15000),
      });

      const dbName = shop.gbp_shop_name || shop.name;
      const dbAddress = [shop.state, shop.city, shop.address, shop.building].filter(Boolean).join("");
      const dbPhone = shop.phone || "";

      if (!res.ok) {
        errors++;
        results.push({
          shop_id: shop.id, shop_name: shop.name,
          db_name: dbName, db_address: dbAddress, db_phone: dbPhone,
          gbp_name: "", gbp_address: "", gbp_phone: "",
          name_match: false, address_match: false, phone_match: false,
          status: "GBP取得エラー", detail: `Go API ${res.status}`,
        });
        continue;
      }

      const gbp = await res.json();
      const gbpName = gbp.title || gbp.locationName || gbp.name || "";
      const gbpAddr = gbp.storefrontAddress || gbp.address || {};
      const gbpAddress = typeof gbpAddr === "string" ? gbpAddr
        : [gbpAddr.administrativeArea, gbpAddr.locality, ...(gbpAddr.addressLines || [])].filter(Boolean).join("");
      const gbpPhone = gbp.phoneNumbers?.primaryPhone || gbp.primaryPhone || gbp.phone || "";

      const nameMatch = !gbpName || normalize(dbName) === normalize(gbpName)
        || normalize(dbName).includes(normalize(gbpName))
        || normalize(gbpName).includes(normalize(dbName));
      const addrMatch = !gbpAddress || normalize(dbAddress) === normalize(gbpAddress)
        || normalize(dbAddress).includes(normalize(gbpAddress))
        || normalize(gbpAddress).includes(normalize(dbAddress));
      const phoneMatch = !dbPhone || !gbpPhone || normalizePhone(dbPhone) === normalizePhone(gbpPhone);

      const diffs: string[] = [];
      if (!nameMatch) diffs.push("店名不一致");
      if (!addrMatch) diffs.push("住所不一致");
      if (!phoneMatch) diffs.push("電話番号不一致");

      results.push({
        shop_id: shop.id, shop_name: shop.name,
        db_name: dbName, db_address: dbAddress, db_phone: dbPhone,
        gbp_name: gbpName, gbp_address: gbpAddress, gbp_phone: gbpPhone,
        name_match: nameMatch, address_match: addrMatch, phone_match: phoneMatch,
        status: diffs.length === 0 ? "OK" : diffs.join(" / "), detail: "",
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
 */
export async function GET() {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("nap_check_results")
    .select("*")
    .order("shop_name", { ascending: true });

  return NextResponse.json(data || []);
}
