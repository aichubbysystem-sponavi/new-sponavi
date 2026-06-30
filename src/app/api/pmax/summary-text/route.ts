import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const SYSTEM_PROMPT = `あなたはP-MAX広告とGoogleマップ集客に特化したプロの広告運用者です。
提供されたデータを読み取り、以下の【テンプレート】に厳密に従って文章を出力してください。
構成・段落の順番・箇条書きの形式は絶対に変えないでください。

【テンプレート（この構成を必ず守ること）】

---
お世話になっております。
{N}月の広告データがまとまりましたのでご報告いたします。

今月は 表示{表示回数}回（先月比 {増減}％）、クリック{クリック数}件（{増減}％）／クリック率{CTR}％ と、{クリック率の評価文}。

MAPからの行動は以下の通りです。
・経路案内：{数値}件（{増減}％）
・WEBサイト遷移：{数値}件（{増減}％）
・メニュークリック：{数値}件（{増減}％）
・保存・共有：{数値}件（{増減}％）
・電話：{数値}件（{増減}％）
・合計来店数：{数値}件（{増減}％）

{データを踏まえた総評を1〜2文で。悪い点→良い点の順。}

{来月以降の方針を1文で。}

引き続きよろしくお願いいたします。
---

【厳守ルール】
- テンプレートの構成・段落順・箇条書き形式を絶対に変えない
- 数値が0件でも省略せず「0件」と記載する。「まだ反映されていない」等の推測は絶対にしない
- 提供された数値をそのまま正確に使う
- クリック率が0.3％以上なら「業界平均の0.3〜0.6％」と比較して良い点として説明する。0.3％未満ならクリック率の評価文は省略する
- 増減の書式: ＋12.3％ / －5.6％ / ±0.0％（全角記号を使う）
- 先月が0件→今月に値がある場合は「NEW」と記載する
- 悪い部分がない場合は総評で無理に悪い点を作らない
- 悪い部分も記載する場合は、必ず「悪い点→良い点」の順（〜であるものの、〜は好調です）
- 文章のみ出力する。見出し・マークダウン記法・注釈は使わない
- 丁寧語で、専門用語は使いすぎず初心者でも理解しやすい文にする`;

interface KpiData {
  currentMonth: string;
  impressions: { current: number; prev: number };
  clicks: { current: number; prev: number };
  cost: { current: number; prev: number };
  ctr: { current: number; prev: number };
  totalVisits: { current: number; prev: number };
  phone: { current: number; prev: number };
  directions: { current: number; prev: number };
  menuClicks: { current: number; prev: number };
  website: { current: number; prev: number };
  saveShare: { current: number; prev: number };
}

function formatPct(current: number, prev: number): string {
  if (prev === 0 && current === 0) return "±0.0％";
  if (prev === 0) return "NEW";
  const pct = ((current - prev) / prev) * 100;
  return `${pct >= 0 ? "＋" : "－"}${Math.abs(pct).toFixed(1)}％`;
}

function buildUserPrompt(data: KpiData): string {
  const costYen = (micros: number) => Math.round(micros / 1_000_000);
  const ctrPct = (v: number) => (v * 100).toFixed(2);

  return `以下は${data.currentMonth}のP-MAX広告・GBPデータです。この数値を元に文章を作成してください。

【広告データ】
・表示回数：${data.impressions.current.toLocaleString()}回（先月比 ${formatPct(data.impressions.current, data.impressions.prev)}）
・クリック数：${data.clicks.current.toLocaleString()}件（先月比 ${formatPct(data.clicks.current, data.clicks.prev)}）
・クリック率：${ctrPct(data.ctr.current)}％（先月 ${ctrPct(data.ctr.prev)}％）
・広告費：¥${costYen(data.cost.current).toLocaleString()}（先月比 ${formatPct(costYen(data.cost.current), costYen(data.cost.prev))}）

【MAP行動データ】
・合計来店数：${data.totalVisits.current.toLocaleString()}件（先月比 ${formatPct(data.totalVisits.current, data.totalVisits.prev)}）
・電話：${data.phone.current.toLocaleString()}件（先月比 ${formatPct(data.phone.current, data.phone.prev)}）
・経路案内：${data.directions.current.toLocaleString()}件（先月比 ${formatPct(data.directions.current, data.directions.prev)}）
・WEBサイト：${data.website.current.toLocaleString()}件（先月比 ${formatPct(data.website.current, data.website.prev)}）
・メニュークリック：${data.menuClicks.current.toLocaleString()}件（先月比 ${formatPct(data.menuClicks.current, data.menuClicks.prev)}）
・保存・共有：${data.saveShare.current.toLocaleString()}件（先月比 ${formatPct(data.saveShare.current, data.saveShare.prev)}）`;
}

export async function POST(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  try {
    const body: KpiData = await request.json();
    const userPrompt = buildUserPrompt(body);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      cache: "no-store",
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({ error: `Claude API error: ${res.status} ${errText.slice(0, 200)}` }, { status: 502 });
    }

    const result = await res.json();
    const text = result.content?.[0]?.text || "";

    return NextResponse.json({ text });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
