import { createClient } from "@supabase/supabase-js";
import SurveyForm from "./client";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

export default async function SurveyPage({ params }: { params: { shopId: string } }) {
  const shopId = decodeURIComponent(params.shopId);
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 店舗名を取得
  const { data: shop } = await supabase
    .from("shops")
    .select("id, name")
    .eq("id", shopId)
    .maybeSingle();

  // 店舗名でも検索
  let shopData = shop;
  if (!shopData) {
    const { data: byName } = await supabase
      .from("shops")
      .select("id, name")
      .ilike("name", `%${shopId}%`)
      .limit(1)
      .maybeSingle();
    shopData = byName;
  }

  if (!shopData) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center max-w-md">
          <p className="text-gray-500">店舗が見つかりませんでした</p>
        </div>
      </div>
    );
  }

  return <SurveyForm shopId={shopData.id} shopName={shopData.name} />;
}
