"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import DashboardClient from "./client";

/**
 * ダッシュボードデータを認証付きAPI経由で取得してから DashboardClient を描画。
 * サーバーコンポーネントで実データをHTMLに埋め込まないことで未認証漏洩を防ぐ。
 */
export default function DashboardDataLoader({ shopId }: { shopId: string }) {
  const [state, setState] = useState<"loading" | "denied" | "notfound" | "ready">("loading");
  const [payload, setPayload] = useState<any>(null);
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
        if (!token) { if (!cancelled) redirectToLogin(); return; }

        const res = await fetch(`/api/report/dashboard-data?shopId=${encodeURIComponent(shopId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;
        if (res.status === 401) { redirectToLogin(); return; }
        if (res.status === 403) { setState("denied"); return; }
        if (!res.ok) { setState("notfound"); return; }

        const json = await res.json();
        if (cancelled) return;
        setPayload(json);
        setState("ready");
      } catch {
        if (!cancelled) setState("notfound");
      }
    })();

    return () => { cancelled = true; };
  }, [shopId, router]);

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-12 shadow-lg text-center max-w-md">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="text-xl font-bold text-[#003D6B] mb-3">アクセス権がありません</h1>
          <p className="text-slate-500 text-sm mb-6">このダッシュボードを閲覧する権限がありません。</p>
          <a href="/report" className="inline-block px-6 py-2 bg-[#003D6B] text-white rounded-lg text-sm font-semibold hover:bg-[#002a4a] transition">← 戻る</a>
        </div>
      </div>
    );
  }

  if (state === "notfound" || !payload) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl p-8 shadow-lg text-center">
          <p className="text-gray-500">店舗が見つかりませんでした</p>
        </div>
      </div>
    );
  }

  return (
    <DashboardClient
      shop={payload.shop}
      totalReviews={payload.totalReviews}
      unrepliedCount={payload.unrepliedCount}
      avgRating={payload.avgRating}
      recentReviews={payload.recentReviews}
      monthlyStats={payload.monthlyStats}
      rankingData={payload.rankingData}
      analysis={payload.analysis}
    />
  );
}
