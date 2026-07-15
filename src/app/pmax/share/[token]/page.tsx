"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PmaxReportView, { type PmaxReportData } from "@/components/pmax-report-view";

export default function SharedPmaxReport() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<PmaxReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`/api/pmax/share/${token}`);
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
  }, [token]);

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
          <p style={{ color: "#666", fontSize: 14 }}>{error || "無効なリンクです"}</p>
        </div>
      </div>
    );
  }

  return <PmaxReportView data={data} />;
}
