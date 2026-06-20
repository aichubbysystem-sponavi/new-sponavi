import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";


/**
 * POST /api/report/bulk-generate
 * 複数店舗の投稿文をAIで一括生成 → scheduled_postsに保存（社長・マネージャーのみ）
 */
export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;
  if (!ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEYが設定されていません" }, { status: 500 });

  const body = await request.json();
  const { shopIds, startDate, postsPerShop, topicType } = body as {
    shopIds: string[];
    startDate: string; // "2026-04-15"
    postsPerShop: number;
    topicType?: string;
  };

  if (!shopIds || shopIds.length === 0 || !startDate) {
    return NextResponse.json({ error: "shopIds, startDateが必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const count = Math.min(postsPerShop || 4, 8);
  const results: { shopName: string; generated: number; error?: string }[] = [];

  const targetIds = shopIds.slice(0, 50);

  // バッチ取得（N+1→2クエリ）
  const { data: allShops } = await supabase
    .from("shops")
    .select("id, name, gbp_shop_name")
    .in("id", targetIds);
  const shopMap = new Map((allShops || []).map(s => [s.id, s]));

  const { data: allHearings } = await supabase
    .from("hearing_sheets")
    .select("shop_id, data")
    .in("shop_id", targetIds);
  const hearingMap = new Map((allHearings || []).map(h => [h.shop_id, h.data]));

  for (const shopId of targetIds) {
    const shop = shopMap.get(shopId);
    if (!shop) { results.push({ shopName: shopId, generated: 0, error: "店舗不明" }); continue; }

    const hearing = hearingMap.get(shopId) || {};
    const hearingInfo = Object.entries(hearing)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const prompt = `「${shop.name}」のGBP投稿文を${count}件生成してください。

${hearingInfo ? `【店舗情報】\n${hearingInfo}` : ""}

【条件】
- 各200〜400文字
- MEO対策キーワードを自然に含める
- 各投稿の切り口を変える（メニュー紹介/スタッフ/雰囲気/イベント/お客様の声等）
- 以下の形式で出力:

1.
(投稿文)

2.
(投稿文)`;

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2500, messages: [{ role: "user", content: prompt }] }),
      });

      if (!res.ok) { results.push({ shopName: shop.name, generated: 0, error: `API ${res.status}` }); continue; }

      const data = await res.json();
      const text = data.content?.[0]?.text?.trim() || "";

      // パース
      const posts: string[] = [];
      const parts = text.split(/\n\d+\.\s*\n/);
      for (const part of parts) {
        const cleaned = part.trim();
        if (cleaned && cleaned.length > 30) posts.push(cleaned);
      }
      if (posts.length === 0) {
        const lines = text.split(/\n(?=\d+\.)/);
        for (const line of lines) {
          const cleaned = line.replace(/^\d+\.\s*/, "").trim();
          if (cleaned && cleaned.length > 30) posts.push(cleaned);
        }
      }

      // 予約投稿に保存
      let generated = 0;
      const start = new Date(startDate);
      for (let i = 0; i < posts.length; i++) {
        const scheduledDate = new Date(start);
        scheduledDate.setDate(start.getDate() + Math.floor(i * 7 / posts.length) * (30 / count));
        // 3〜4日おきに分散
        scheduledDate.setDate(start.getDate() + i * Math.ceil(28 / posts.length));
        scheduledDate.setHours(10 + (i % 3), 0, 0);

        const { error } = await supabase.from("scheduled_posts").insert({
          shop_id: shopId,
          shop_name: shop.name,
          summary: posts[i].slice(0, 1500),
          topic_type: topicType || "STANDARD",
          scheduled_at: scheduledDate.toISOString(),
          status: "pending",
        });
        if (!error) generated++;
      }

      results.push({ shopName: shop.name, generated });
    } catch (e: any) {
      results.push({ shopName: shop.name, generated: 0, error: e.message });
    }
  }

  const totalGenerated = results.reduce((s, r) => s + r.generated, 0);
  return NextResponse.json({ results, totalGenerated, totalShops: results.length });
}
