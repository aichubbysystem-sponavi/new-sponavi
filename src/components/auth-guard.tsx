"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation";
import api from "@/lib/api";

// === 壁9追加: セッション自動タイムアウト ===
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分

export default function AuthGuard({ children, skipAuth }: { children: React.ReactNode; skipAuth?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  // セッションタイムアウト: 操作がなければ自動ログアウト
  // routerをrefで保持して依存配列の再生成チェーンを断ち切る
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!authenticated || pathname === "/login") return;

    const logout = async () => {
      await supabase.auth.signOut();
      routerRef.current.push("/login");
    };

    let timer: NodeJS.Timeout | null = null;
    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(logout, SESSION_TIMEOUT_MS);
    };

    const events = ["mousedown", "keydown", "scroll", "touchstart", "batch-activity"];
    events.forEach((event) => window.addEventListener(event, resetTimer));
    resetTimer();

    return () => {
      events.forEach((event) => window.removeEventListener(event, resetTimer));
      if (timer) clearTimeout(timer);
    };
  }, [authenticated, pathname]);

  useEffect(() => {
    if (skipAuth) return;

    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setAuthenticated(true);
        // pendingチェック
        try {
          const res = await api.get("/api/report/my-role");
          if (res.data.role === "pending") {
            setIsPending(true);
          }
        } catch {}
      } else if (pathname !== "/login") {
        // サブドメインの場合はメインドメインのログインページにリダイレクト
        const host = window.location.hostname;
        if (host.startsWith("report.") || host.startsWith("p-max.")) {
          window.location.href = `https://new-spotlight-navigator.com/login`;
        } else {
          router.push("/login");
        }
      }
      setLoading(false);
    };

    checkAuth();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setAuthenticated(true);
      } else {
        setAuthenticated(false);
        if (pathname !== "/login") {
          const host = window.location.hostname;
          if (host.startsWith("report.") || host.startsWith("p-max.")) {
            window.location.href = `https://new-spotlight-navigator.com/login`;
          } else {
            router.push("/login");
          }
        }
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [pathname, router, skipAuth]);

  if (pathname === "/login" || skipAuth) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#E6EEFF]">
        <p className="text-[#003D6B] text-lg">読み込み中...</p>
      </div>
    );
  }

  if (!authenticated) {
    return null;
  }

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#E6EEFF]" style={{ marginLeft: 0 }}>
        <div className="bg-white rounded-2xl shadow-xl p-10 w-[460px] text-center">
          <div className="mb-6">
            <h1 className="text-2xl font-bold">
              <span className="text-[#003D6B]">SPOTLIGHT</span>
              <span className="text-[#E6A817]"> NAVIGATOR</span>
            </h1>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 mb-6">
            <p className="text-amber-700 font-semibold mb-2">承認待ち</p>
            <p className="text-sm text-amber-600">アカウントの登録申請を受け付けました。</p>
            <p className="text-sm text-amber-600">管理者の承認をお待ちください。</p>
          </div>
          <button
            onClick={async () => {
              await supabase.auth.signOut();
              router.push("/login");
            }}
            className="text-sm text-slate-400 hover:text-[#003D6B] transition"
          >
            ログアウト
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
