import { getShopList } from "@/lib/report-api";
import { createClient } from "@supabase/supabase-js";
import ReportListClient from "./report-list-client";

export const revalidate = 3600; // 1時間キャッシュ（反映ボタンで即時更新）

async function getAnalyzedShops(): Promise<Set<string>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new Set();

  try {
    const supabase = createClient(url, key);
    const { data } = await supabase.from("report_analysis").select("shop_name");
    return new Set((data || []).map((r: { shop_name: string }) => r.shop_name));
  } catch {
    return new Set();
  }
}

export default async function ReportListPage() {
  const [{ shops, source }, analyzedSet] = await Promise.all([
    getShopList(),
    getAnalyzedShops(),
  ]);

  // 分析ステータスをマージ
  const shopsWithStatus = shops.map((s) => ({
    ...s,
    analyzed: analyzedSet.has(s.name),
  }));

  return <ReportListClient shops={shopsWithStatus} source={source} />;
}
