"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation";

// === 壁9追加: セッション自動タイムアウト ===
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分

export default function AuthGuard({ children, skipAuth }: { children: React.ReactNode; skipAuth?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut();
    router.push("/login");
  }, [router]);

  // セッションタイムアウト: 操作がなければ自動ログアウト
  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      handleLogout();
    }, SESSION_TIMEOUT_MS);
  }, [handleLogout]);

  useEffect(() => {
    if (!authenticated || pathname === "/login") return;

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
    const handler = () => resetTimeout();

    events.forEach((event) => window.addEventListener(event, handler));
    resetTimeout(); // 初期タイマーセット

    return () => {
      events.forEach((event) => window.removeEventListener(event, handler));
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [authenticated, pathname, resetTimeout]);

  // レポートサブドメイン検出（AuthGuard内で直接チェック）
  const isReportDomain = typeof window !== "undefined" && window.location.hostname.startsWith("report.");

  useEffect(() => {
    if (skipAuth || isReportDomain) return; // レポートサブドメインでは認証スキップ

    const checkAuth = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setAuthenticated(true);
      } else if (pathname !== "/login") {
        router.push("/login");
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
          router.push("/login");
        }
      }
    });

    return () => {
      listener.subscription.unsubscribe();
    };
  }, [pathname, router, skipAuth, isReportDomain]);

  if (pathname === "/login" || skipAuth || isReportDomain) {
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

  return <>{children}</>;
}
