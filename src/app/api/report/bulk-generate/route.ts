import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

/**
 * POST /api/report/bulk-generate
 * 複数店舗の投稿文をAIで一括生成 → scheduled_postsに保存
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
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

  for (const shopId of shopIds.slice(0, 50)) {
    // 店舗情報取得
    const { data: shop } = await supabase
      .from("shops")
      .select("id, name, gbp_shop_name")
      .eq("id", shopId)
      .single();

    if (!shop) { results.push({ shopName: shopId, generated: 0, error: "店舗不明" }); continue; }

    // ヒアリングシート取得
    const { data: hearingData } = await supabase
      .from("hearing_sheets")
      .select("data")
      .eq("shop_id", shopId)
      .maybeSingle();

    const hearing = hearingData?.data || {};
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
