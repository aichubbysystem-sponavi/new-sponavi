"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import ReportClient from "./client";
import type { ReportData } from "@/lib/report-data";

type Source = "cache" | "spreadsheet" | "mock";

/**
 * レポートデータを「認証付きAPI経由」でクライアント取得してから ReportClient を描画する。
 * サーバーコンポーネントで実データをHTMLに埋め込まないことで、未ログイン者への
 * データ漏洩（Critical-1）を防ぐ。ReportClient 自体は従来どおり data を受け取る。
 */
export default function ReportDataLoader({
  shopId,
  targetMonth,
}: {
  shopId: string;
  targetMonth?: string;
}) {
  const [state, setState] = useState<"loading" | "denied" | "notfound" | "ready">("loading");
  const [payload, setPayload] = useState<{ data: ReportData; source: Source; googleReviewUrl: string | null } | null>(null);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    const redirectToLogin = () => {
      const host = window.location.hostname;
      if (host.startsWith("report.") || host.startsWith("p-max.")) {
        window.location.href = "https://new-spotlight-navigator.com/login";
      } else {
        router.push("/login");
      }
    };

    (async () => {
      try {
        const { data: sess } = await supabase.auth.getSession();
        const token = sess.session?.access_token;
        if (!token) {
          if (!cancelled) redirectToLogin();
          return;
        }

        const qs = new URLSearchParams({ shopId: encodeURIComponent(shopId) });
        if (targetMonth) qs.set("month", targetMonth);

        const res = await fetch(`/api/report/data?${qs.toString()}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;

        if (res.status === 401) { redirectToLogin(); return; }
        if (res.status === 403) { setState("denied"); return; }
        if (!res.ok) { setState("notfound"); return; }

        const json = await res.json();
        if (cancelled) return;
        if (!json?.data) { setState("notfound"); return; }

        setPayload({ data: json.data as ReportData, source: (json.source as Source) || "mock", googleReviewUrl: json.googleReviewUrl ?? null });
        setState("ready");
      } catch {
        if (!cancelled) setState("notfound");
      }
    })();

    return () => { cancelled = true; };
  }, [shopId, targetMonth, router]);

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a1628] to-[#1a2a44] flex items-center justify-center">
        <p className="text-white/80 text-lg">レポートを読み込み中...</p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a1628] to-[#1a2a44] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-[#003D6B] mb-3">アクセス権がありません</h1>
          <p className="text-slate-500 text-sm mb-6">この店舗のレポートを閲覧する権限がありません。</p>
          <a href="/report" className="inline-block px-6 py-2 bg-[#003D6B] text-white rounded-lg text-sm font-semibold hover:bg-[#002a4a] transition">← レポート一覧に戻る</a>
        </div>
      </div>
    );
  }

  if (state === "notfound" || !payload) {
    const shopName = decodeURIComponent(shopId);
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#0a1628] to-[#1a2a44] flex items-center justify-center">
        <div className="bg-white rounded-2xl shadow-xl p-12 max-w-md text-center">
          <div className="text-5xl mb-4">📊</div>
          <h1 className="text-xl font-bold text-[#003D6B] mb-3">{shopName}</h1>
          <p className="text-slate-500 text-sm mb-6">この店舗のレポートデータは準備中です。<br />パフォーマンスデータが登録されるとレポートが表示されます。</p>
          <a href="/report" className="inline-block px-6 py-2 bg-[#003D6B] text-white rounded-lg text-sm font-semibold hover:bg-[#002a4a] transition">← レポート一覧に戻る</a>
        </div>
      </div>
    );
  }

  return (
    <ReportClient
      data={payload.data}
      shopId={shopId}
      dataSource={payload.source}
      googleReviewUrl={payload.googleReviewUrl}
      targetMonth={targetMonth}
    />
  );
}
