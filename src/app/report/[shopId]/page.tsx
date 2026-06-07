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
  searchParams,
}: {
  params: { shopId: string };
  searchParams: { month?: string };
}) {
  const shopName = decodeURIComponent(params.shopId);
  const targetMonth = searchParams.month || undefined;
  const [{ data, source }, reviewUrl] = await Promise.all([
    getReportData(params.shopId, targetMonth),
    getGoogleReviewUrl(shopName),
  ]);

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a1628] to-[#1a2a44] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md text-center">
          <div className="text-5xl mb-4">📊</div>
          <h1 className="text-xl font-bold text-[#003D6B] mb-3">{shopName}</h1>
          <p className="text-slate-500 text-sm mb-6">この店舗のレポートデータは準備中です。<br />パフォーマンスデータが登録されるとレポートが表示されます。</p>
          <a href="/report" className="inline-block px-6 py-2 bg-[#003D6B] text-white rounded-lg text-sm font-semibold hover:bg-[#002a4a] transition">← レポート一覧に戻る</a>
        </div>
      </div>
    );
  }

  return <ReportClient data={data} shopId={params.shopId} dataSource={source} googleReviewUrl={reviewUrl} />;
}
