"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter, usePathname } from "next/navigation";

// === 壁9追加: セッション自動タイムアウト ===
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30分

export default function AuthGuard({ children, skipAuth }: { children: React.ReactNode; skipAuth?: boolean }) {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
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

    const events = ["mousedown", "keydown", "scroll", "touchstart"];
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

  return <>{children}</>;
}
