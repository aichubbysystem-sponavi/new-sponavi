"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import AuthGuard from "@/components/auth-guard";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  return (
    <AuthGuard>
      {isLoginPage ? (
        children
      ) : (
        <>
          <Header />
          <div className="flex w-full">
            <Sidebar />
            <main className="w-[85%] ml-[15%] min-w-0 pt-[60px] min-h-screen p-6">
              {children}
            </main>
          </div>
        </>
      )}
    </AuthGuard>
  );
}
