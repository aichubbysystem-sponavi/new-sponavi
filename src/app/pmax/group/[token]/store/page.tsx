"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import PmaxReportView, { type PmaxReportData } from "@/components/pmax-report-view";

function LoadingScreen() {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
      <div style={{ textAlign: "center", color: "#fff" }}>
        <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.3)", borderTopColor: "#e94560", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
        <p style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>レポートを読み込み中...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  );
}

export default function GroupStoreReport() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <GroupStoreReportInner />
    </Suspense>
  );
}

function GroupStoreReportInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = String(params?.token || "");
  const name = searchParams.get("name") || "";
  const year = searchParams.get("year") || "";
  const month = searchParams.get("month") || "";

  const [data, setData] = useState<PmaxReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !name) {
      setError("店舗が指定されていません");
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const qs = new URLSearchParams({ name });
        if (year) qs.set("year", year);
        if (month) qs.set("month", month);
        const res = await fetch(`/api/pmax/group-share/${encodeURIComponent(token)}/store?${qs.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "レポートの取得に失敗しました");
        }
        const d = await res.json();
        setData({
          monthly: d.monthly || [],
          daily: d.daily || [],
          gbp: d.gbp || [],
          channels: d.channels || [],
          shopName: d.shopName,
          year: d.year,
          month: d.month,
          summaryText: d.summaryText || "",
        });
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, name, year, month]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e" }}>
        <div style={{ textAlign: "center", color: "#fff" }}>
          <div style={{ width: 40, height: 40, border: "3px solid rgba(255,255,255,.3)", borderTopColor: "#e94560", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto" }} />
          <p style={{ marginTop: 16, fontSize: 14, opacity: 0.7 }}>レポートを読み込み中...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      </div>
    );
  }

  if (error || !data || !data.shopName) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#1a1a2e", padding: 24 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: 32, maxWidth: 500, width: "100%", textAlign: "center" }}>
          <h2 style={{ color: "#c0392b", fontSize: 18, fontWeight: 700, marginBottom: 8 }}>レポートを表示できません</h2>
          <p style={{ color: "#666", fontSize: 14, marginBottom: 16 }}>{error || "無効なリンクです"}</p>
          <a href={`/pmax/group/${encodeURIComponent(token)}`} style={{ color: "#0f3460", fontSize: 14, fontWeight: 600 }}>← 一覧へ戻る</a>
        </div>
      </div>
    );
  }

  return <PmaxReportView data={data} backHref={`/pmax/group/${encodeURIComponent(token)}`} />;
}
