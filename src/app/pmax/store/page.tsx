"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRole } from "@/components/role-provider";
import { can, PERMISSION_DENIED_HINT } from "@/lib/permissions";
import PmaxReportView, { type CampaignRow, type GbpRow, type ChannelRow } from "@/components/pmax-report-view";
import { applyAdsOverrides, applyGbpOverrides, EMPTY_PMAX_SETTINGS, type PmaxReportSettings } from "@/lib/pmax-overrides";

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
  const { role } = useRole();
  const canData = can(role, "DATA_OP"); // 共有URL発行/停止（社長・幹部）
  const searchParams = useSearchParams();
  const shopName = searchParams.get("name") || "";
  const paramYear = searchParams.get("year");
  const paramMonth = searchParams.get("month");
  const router = useRouter();

  const [monthly, setMonthly] = useState<CampaignRow[]>([]);
  const [daily, setDaily] = useState<CampaignRow[]>([]);
  const [gbpRows, setGbpRows] = useState<GbpRow[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [summaryText, setSummaryText] = useState("");
  const [summaryRequested, setSummaryRequested] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // 表示設定＋数値上書き（DB保存・共有URLにも反映される）
  const [settings, setSettings] = useState<PmaxReportSettings>(EMPTY_PMAX_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"" | "saving" | "saved" | "error">("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setChannels(adsData.channels || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "取得に失敗しました");
      } finally { setLoading(false); }
    })();
  }, [shopName, targetYear, targetMonthNum]);

  // 表示設定＋数値上書きの読み込み（店舗単位）
  useEffect(() => {
    if (!shopName) return;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`/api/pmax/report-settings?shopName=${encodeURIComponent(shopName)}`, { headers });
        if (res.ok) {
          const d = await res.json();
          setSettings({ overrides: d.overrides || {}, sectionVisibility: d.sectionVisibility || {}, summaryOverride: d.summaryOverride || "" });
        }
      } catch {
        // 読み込み失敗時はデフォルト（全表示・上書きなし）のまま
      } finally {
        setSettingsLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shopName]);

  // 変更をデバウンスしてDB保存（上書きされない限り永続保存）
  const handleSettingsChange = (next: PmaxReportSettings) => {
    setSettings(next);
    setSaveState("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch("/api/pmax/report-settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ shopName, overrides: next.overrides, sectionVisibility: next.sectionVisibility, summaryOverride: next.summaryOverride }),
        });
        setSaveState(res.ok ? "saved" : "error");
      } catch {
        setSaveState("error");
      }
    }, 600);
  };

  // KPIデータが揃ったらAI文章を1回だけ生成（C2修正: summaryRequestedで制御）
  // 手動編集（数値上書き）の読み込み完了を待ち、編集後の数値で文章を作る（本文との矛盾防止）
  useEffect(() => {
    if (monthly.length === 0 || summaryRequested || !settingsLoaded) return;
    setSummaryRequested(true);
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (token) headers.Authorization = `Bearer ${token}`;

        const curKey = `${targetYear}-${String(targetMonthNum).padStart(2, "0")}`;
        const prevD = new Date(targetYear, targetMonthNum - 2, 1);
        const prevKey = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;

        const ov = settings.overrides;
        const sumMonth = (key: string) => {
          // 言語別に集計→上書き適用→合算（レポート本文と同じ手順）
          const byLang = new Map<string, { impressions: number; clicks: number; ctr: number; averageCpc: number; costMicros: number }>();
          for (const r of monthly) {
            if (!(r.month || "").startsWith(key)) continue;
            const agg = byLang.get(r.language) || { impressions: 0, clicks: 0, ctr: 0, averageCpc: 0, costMicros: 0 };
            agg.impressions += r.impressions; agg.clicks += r.clicks; agg.costMicros += r.costMicros;
            byLang.set(r.language, agg);
          }
          let imp = 0, clk = 0, cost = 0;
          for (const [lang, agg] of Array.from(byLang.entries())) {
            applyAdsOverrides(agg, `m|${lang}|${key}`, ov);
            imp += agg.impressions; clk += agg.clicks; cost += agg.costMicros;
          }
          if (ov[`k|${key}|impressions`] !== undefined) imp = ov[`k|${key}|impressions`];
          if (ov[`k|${key}|clicks`] !== undefined) clk = ov[`k|${key}|clicks`];
          if (ov[`k|${key}|costYen`] !== undefined) cost = Math.round(ov[`k|${key}|costYen`] * 1_000_000);
          return { imp, clk, cost, ctr: imp > 0 ? clk / imp : 0, cpc: clk > 0 ? cost / clk : 0 };
        };
        const cur = sumMonth(curKey);
        const prev = sumMonth(prevKey);

        const gbpCurKey = `${targetYear}/${String(targetMonthNum).padStart(2, "0")}`;
        const gbpPrevKey = `${prevD.getFullYear()}/${String(prevD.getMonth() + 1).padStart(2, "0")}`;
        const findGbp = (mKey: string) => {
          const row = gbpRows.find(r => r.month === mKey);
          if (!row) return undefined;
          const copy = { ...row };
          applyGbpOverrides(copy, ov);
          return copy;
        };
        const gbpCur = findGbp(gbpCurKey);
        const gbpPrv = findGbp(gbpPrevKey);

        // 初月判定: 対象月より前に実績のある広告月次データが1件も無ければ初月
        // （月キーはYYYY-MM形式なので文字列比較で時系列比較できる）
        const isFirstMonth = !monthly.some(
          (r) =>
            (r.month || "").slice(0, 7) < curKey &&
            (r.impressions > 0 || r.clicks > 0 || r.costMicros > 0),
        );

        const body = {
          shopName, // キャッシュキー: 同じ店×月×データなら再生成せず同じ文面を返す
          monthKey: curKey,
          currentMonth: `${targetYear}年${targetMonthNum}月`,
          isFirstMonth,
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
          reservation: { current: gbpCur?.reservation ?? 0, prev: gbpPrv?.reservation ?? 0 },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthly, gbpRows, summaryRequested, settingsLoaded, targetYear, targetMonthNum]);

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
                  body: JSON.stringify({ shopName, year: targetYear, month: targetMonthNum, summaryText: settings.summaryOverride || summaryText }),
                });
                if (!res.ok) throw new Error("発行失敗");
                const { token: shareToken } = await res.json();
                const url = `${window.location.origin}/pmax/share/${shareToken}`;
                await navigator.clipboard.writeText(url);
                alert("共有URLをコピーしました");
              } catch { alert("共有URL発行に失敗しました"); }
            }}
            disabled={!canData}
            title={!canData ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
            style={{ color: "#fff", background: "rgba(79,195,247,0.2)", border: "1px solid rgba(79,195,247,0.4)", padding: "5px 14px", borderRadius: 8, cursor: canData ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, opacity: canData ? 1 : 0.4 }}
          >
            共有URLを発行
          </button>
          <button
            onClick={async () => {
              if (!confirm("この店舗・月の共有URLを停止します。既に配布済みのURLは開けなくなります。よろしいですか？")) return;
              try {
                const token = (await supabase.auth.getSession()).data.session?.access_token;
                const res = await fetch("/api/pmax/share", {
                  method: "DELETE",
                  headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                  body: JSON.stringify({ shopName, year: targetYear, month: targetMonthNum }),
                });
                if (!res.ok) throw new Error("失効失敗");
                alert("共有URLを停止しました");
              } catch { alert("共有URLの停止に失敗しました"); }
            }}
            disabled={!canData}
            title={!canData ? PERMISSION_DENIED_HINT.DATA_OP : undefined}
            style={{ color: "rgba(255,255,255,0.85)", background: "rgba(244,67,54,0.15)", border: "1px solid rgba(244,67,54,0.4)", padding: "5px 14px", borderRadius: 8, cursor: canData ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, opacity: canData ? 1 : 0.4 }}
          >
            共有を停止
          </button>
          <span style={{ fontSize: 12, color: "#4fc3f7", background: "rgba(79,195,247,0.15)", padding: "4px 12px", borderRadius: 20, border: "1px solid rgba(79,195,247,0.3)" }}>P-MAX広告レポート</span>
        </div>
      </div>

      {/* レポート本体（共有ページと共通コンポーネント） */}
      <PmaxReportView
        data={{ monthly, daily, gbp: gbpRows, channels, shopName, year: targetYear, month: targetMonthNum, summaryText }}
        settings={settings}
        editable={canData}
        onSettingsChange={canData ? handleSettingsChange : undefined}
        saveState={saveState}
      />
    </div>
  );
}
