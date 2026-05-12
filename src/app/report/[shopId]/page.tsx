import { getReportData } from "@/lib/report-api";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import ReportClient from "./client";

export const revalidate = 0;

async function getGoogleReviewUrl(shopName: string): Promise<string> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "",
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
    );
    const { data } = await supabase
      .from("shops")
      .select("gbp_place_id")
      .eq("name", shopName)
      .maybeSingle();
    if (data?.gbp_place_id) {
      return `https://search.google.com/local/reviews?placeid=${data.gbp_place_id}`;
    }
  } catch {}
  // フォールバック: 店舗名でGoogleマップ検索
  return `https://www.google.com/maps/search/${encodeURIComponent(shopName + " 口コミ")}`;
}

export default async function ReportPage({
  params,
}: {
  params: { shopId: string };
}) {
  const shopName = decodeURIComponent(params.shopId);
  const [{ data, source }, reviewUrl] = await Promise.all([
    getReportData(params.shopId),
    getGoogleReviewUrl(shopName),
  ]);

  if (!data) {
    notFound();
  }

  return <ReportClient data={data} shopId={params.shopId} dataSource={source} googleReviewUrl={reviewUrl} />;
}
