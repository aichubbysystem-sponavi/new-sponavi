import { getReportData } from "@/lib/report-api";
import { notFound } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import ReportClient from "./client";

export const revalidate = 0;

async function getPlaceId(shopName: string): Promise<string | null> {
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
    return data?.gbp_place_id || null;
  } catch {
    return null;
  }
}

export default async function ReportPage({
  params,
}: {
  params: { shopId: string };
}) {
  const shopName = decodeURIComponent(params.shopId);
  const [{ data, source }, placeId] = await Promise.all([
    getReportData(params.shopId),
    getPlaceId(shopName),
  ]);

  if (!data) {
    notFound();
  }

  return <ReportClient data={data} shopId={params.shopId} dataSource={source} googleReviewUrl={placeId ? `https://search.google.com/local/reviews?placeid=${placeId}` : null} />;
}
