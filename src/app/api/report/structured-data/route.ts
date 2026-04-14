import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * GET /api/report/structured-data?shopId=xxx
 * 構造化データ(Schema.org JSON-LD)を店舗情報から自動生成
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const shopId = request.nextUrl.searchParams.get("shopId");
  if (!shopId) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const { data: shop } = await supabase
    .from("shops")
    .select("*")
    .eq("id", shopId)
    .single();

  if (!shop) return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });

  // 口コミ統計
  const { count: reviewCount } = await supabase
    .from("reviews").select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  const { data: ratingData } = await supabase
    .from("reviews").select("star_rating")
    .eq("shop_id", shopId).limit(1000);

  const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  let totalRating = 0;
  (ratingData || []).forEach(r => {
    totalRating += ratingMap[(r.star_rating || "").toUpperCase().replace(/_STARS?$/, "")] || 0;
  });
  const avgRating = (ratingData || []).length > 0 ? Math.round((totalRating / ratingData!.length) * 10) / 10 : 0;

  const address = [shop.state, shop.city, shop.address, shop.building].filter(Boolean).join("");

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "name": shop.name || shop.gbp_shop_name,
    ...(address ? { "address": {
      "@type": "PostalAddress",
      "addressLocality": shop.city || "",
      "addressRegion": shop.state || "",
      "streetAddress": shop.address || "",
      "addressCountry": "JP",
      ...(shop.postal_code ? { "postalCode": shop.postal_code } : {}),
    }} : {}),
    ...(shop.phone ? { "telephone": shop.phone } : {}),
    ...(shop.website ? { "url": shop.website } : {}),
    ...(avgRating > 0 ? { "aggregateRating": {
      "@type": "AggregateRating",
      "ratingValue": avgRating,
      "reviewCount": reviewCount || 0,
      "bestRating": 5,
      "worstRating": 1,
    }} : {}),
  };

  // FAQ構造化データ（Q&Aがあれば）
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [] as any[],
  };

  return NextResponse.json({
    localBusiness: jsonLd,
    faq: faqJsonLd,
    script: `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`,
  });
}
