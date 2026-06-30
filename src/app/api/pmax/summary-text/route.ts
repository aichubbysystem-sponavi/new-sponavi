import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";

const SYSTEM_PROMPT = `あなたはP-MAX広告とGoogleマップ集客に特化したプロの広告運用者です。
提供されたデータを読み取り、下記の「文章例」と同じトーン・構成・長さで文章を作成してください。

【文章例】
お世話になっております。
3月の広告データがまとまりましたのでご報告いたします。

今月は 表示552,696回（先月比 ＋22.2％）、クリック3,334件（＋11.1％）／クリック率0.60％ と、業界平均の0.3〜0.6％の上限水準をしっかりキープできております。

MAPからの行動は以下の通りです。
・経路案内：1,201件（＋408.9％）
・WEBサイト遷移：65件（－11.0％）
・メニュークリック：361件（＋2.6％）
・保存・共有：6,402件（＋19.4％）
・電話：36件（＋16.1％）
・予約数：105件（－19.8％）
・合計来店数：234件（－4.5％）

WEBサイト遷移や予約数などはもう一段強化できる余地があるものの、経路案内が先月比＋408.9％と大幅に伸び、保存・共有も6,400件超と高水準を維持しており、認知・興味層の広がりは着実に進んでおります。

来月以降も、引き続き来店に直結しやすい MAP中心の最適化 に比重をおき、予約・来店への転換率が高まるよう調整を進めてまいります。

引き続きよろしくお願いいたします。

【指示】
- 必ず数値を正確に読み取り、上記例と同じ構成で反映する
- 文の長さ・丁寧さ・言葉のリズムを文章例に合わせる
- クリック率は必ず「平均0.3〜0.6％」と比較して良い点として説明する、0.3％より低い場合は記載しない
- MAP行動の数値（経路案内・WEBサイト・保存/共有）を必ず記載
- 専門用語は使いすぎず、初心者でも理解しやすい文に仕上げる
- 悪い部分がない場合は無理に記載しない
- 悪い部分も記載する場合は、必ず悪い点→いい点の順で記載
  NG例：来店数は増えているものの、電話・予約が落ちているため、MAPで検討→行動の導線をもう一段強くする余地があります。
  OK例：電話・予約が落ちているため、MAPで検討→行動の導線をもう一段強くする余地があるものの、来店数は増えています。
- 文章のみ出力する（見出しやマークダウン記法は使わない）`;

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
