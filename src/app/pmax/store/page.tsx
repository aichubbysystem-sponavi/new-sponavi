"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import PmaxReportView, { type CampaignRow, type GbpRow } from "@/components/pmax-report-view";

// ── メインコンポーネント ──
export default function PmaxStoreDetailPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
        <div style={{ textAlign: "center", color: "#fff" }}>
          <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.3)", borderTopColor: "#e94560", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <p style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>読み込み中...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    }>
      <StoreDetailContent />
    </Suspense>
  );
}

function StoreDetailContent() {
  const searchParams = useSearchParams();
  const shopName = searchParams.get("name") || "";
  const paramYear = searchParams.get("year");
  const paramMonth = searchParams.get("month");
  const router = useRouter();

  const [monthly, setMonthly] = useState<CampaignRow[]>([]);
  const [daily, setDaily] = useState<CampaignRow[]>([]);
  const [gbpRows, setGbpRows] = useState<GbpRow[]>([]);
  const [summaryText, setSummaryText] = useState("");
  const [summaryRequested, setSummaryRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // URLパラメータの年月を優先、なければ現在月
  const [now] = useState(() => new Date());
  const targetYear = paramYear ? Number(paramYear) : now.getFullYear();
  const targetMonthNum = paramMonth ? Number(paramMonth) : now.getMonth() + 1;

  useEffect(() => {
    if (!shopName) { setLoading(false); setError("店舗名が指定されていません"); return; }
    (async () => {
      setLoading(true); setError("");
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const monthKey = `${targetYear}-${String(targetMonthNum).padStart(2, "0")}`;
        const adsRes = await fetch(`/api/pmax/store-detail?shopName=${encodeURIComponent(shopName)}&month=${monthKey}`, { headers });
        if (!adsRes.ok) {
          const text = await adsRes.text().catch(() => "");
          throw new Error(`広告データ取得失敗 (${adsRes.status})${text ? ": " + text.slice(0, 100) : ""}`);
        }
        const adsData = await adsRes.json();
        if (adsData.error) throw new Error(adsData.error);
        setMonthly(adsData.monthly || []);
        setDaily(adsData.daily || []);
        setGbpRows(adsData.gbp || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "取得に失敗しました");
      } finally { setLoading(false); }
    })();
  }, [shopName, targetYear, targetMonthNum]);

  // KPIデータが揃ったらAI文章を1回だけ生成（C2修正: summaryRequestedで制御）
  useEffect(() => {
    if (monthly.length === 0 || summaryRequested) return;
    setSummaryRequested(true);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;

        const curKey = `${targetYear}-${String(targetMonthNum).padStart(2, "0")}`;
        const prevD = new Date(targetYear, targetMonthNum - 2, 1);
        const prevKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;

        const sumMonth = (key: string) => {
          const rows = monthly.filter(r => (r.month || "").startsWith(key));
          const imp = rows.reduce((s, r) => s + r.impressions, 0);
          const clk = rows.reduce((s, r) => s + r.clicks, 0);
          const cost = rows.reduce((s, r) => s + r.costMicros, 0);
          return { imp, clk, cost, ctr: imp > 0 ? clk / imp : 0, cpc: clk > 0 ? cost / clk : 0 };
        };
        const cur = sumMonth(curKey);
        const prev = sumMonth(prevKey);

        const gbpCurKey = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}`;
        const gbpPrevKey = `${prevD.getFullYear()}/${String(prevD.getMonth() + 1).padStart(2, "0")}`;
        const gbpCur = gbpRows.find(r => r.month === gbpCurKey);
        const gbpPrv = gbpRows.find(r => r.month === gbpPrevKey);

        const body = {
          shopName, // キャッシュキー: 同じ店×月×データなら再生成せず同じ文面を返す
          monthKey: curKey,
          currentMonth: `${targetYear}年${targetMonthNum}月`,
          impressions: { current: cur.imp, prev: prev.imp },
          clicks: { current: cur.clk, prev: prev.clk },
          cost: { current: cur.cost, prev: prev.cost },
          ctr: { current: cur.ctr, prev: prev.ctr },
          totalVisits: { current: gbpCur?.totalVisits ?? 0, prev: gbpPrv?.totalVisits ?? 0 },
          phone: { current: gbpCur?.phone ?? 0, prev: gbpPrv?.phone ?? 0 },
          directions: { current: gbpCur?.directions ?? 0, prev: gbpPrv?.directions ?? 0 },
          menuClicks: { current: gbpCur?.menuClicks ?? 0, prev: gbpPrv?.menuClicks ?? 0 },
          website: { current: gbpCur?.website ?? 0, prev: gbpPrv?.website ?? 0 },
          saveShare: { current: gbpCur?.saveShare ?? 0, prev: gbpPrv?.saveShare ?? 0 },
        };

        const res = await fetch("/api/pmax/summary-text", { method: "POST", headers, body: JSON.stringify(body) });
        if (res.ok) {
          const data = await res.json();
          if (data.text) setSummaryText(data.text);
        }
      } catch {
        // 文章生成失敗は無視（レポート表示には影響しない）
      }
    })();
  }, [monthly, gbpRows, summaryRequested, targetYear, targetMonthNum]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
        <div style={{ textAlign: "center", color: "#fff" }}>
          <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.3)", borderTopColor: "#e94560", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <p style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>店舗データを取得中...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: 32, maxWidth: 500, width: "100%" }}>
          <h2 style={{ color: "#c0392b", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>エラー</h2>
          <p style={{ color: "#666", fontSize: 14 }}>{error}</p>
          <button onClick={() => router.push(`/pmax?year=${targetYear}&month=${targetMonthNum}`)} style={{ marginTop: 16, padding: "8px 20px", background: "#0f3460", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>戻る</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#1a1a2e", minHeight: "100vh" }}>
      {/* トップバー（管理画面のみ・共有ページには出ない） */}
      <div className="no-print" style={{ background: "rgba(0,0,0,0.3)", padding: "12px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 100, backdropFilter: "blur(10px)" }}>
        <button onClick={() => router.push("/pmax")} style={{ color: "rgba(255,255,255,0.8)", background: "none", border: "none", cursor: "pointer", fontSize: 14 }}>← 店舗一覧に戻る</button>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <button
            onClick={async () => {
              try {
                const token = (await supabase.auth.getSession()).data.session?.access_token;
                const res = await fetch("/api/pmax/share", {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                  body: JSON.stringify({ shopName, year: targetYear, month: targetMonthNum, summaryText }),
                });
                if (!res.ok) throw new Error("発行失敗");
                const { token: shareToken } = await res.json();
                const url = `${window.location.origin}/pmax/share/${shareToken}`;
                await navigator.clipboard.writeText(url);
                alert("共有URLをコピーしました");
              } catch { alert("共有URL発行に失敗しました"); }
            }}
            style={{ color: "#fff", background: "rgba(79,195,247,0.2)", border: "1px solid rgba(79,195,247,0.4)", padding: "5px 14px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}
          >
            共有URLを発行
          </button>
          <span style={{ fontSize: 12, color: "#4fc3f7", background: "rgba(79,195,247,0.15)", padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(79,195,247,0.3)" }}>P-MAX広告レポート</span>
        </div>
      </div>

      {/* レポート本体（共有ページと共通コンポーネント） */}
      <PmaxReportView
        data={{ monthly, daily, gbp: gbpRows, shopName, year: targetYear, month: targetMonthNum, summaryText }}
      />
    </div>
  );
}
