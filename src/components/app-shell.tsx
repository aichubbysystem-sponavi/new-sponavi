"use client";

import { usePathname } from "next/navigation";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import AuthGuard from "@/components/auth-guard";
import RoleProvider from "@/components/role-provider";
import RoleGuard from "@/components/role-guard";
import ShopProvider from "@/components/shop-provider";
import FloatingTasks from "@/components/floating-tasks";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const isLoginPage = pathname === "/login";
  // ミドルウェアがreportサブドメインを/report/*にリライトするため、pathnameだけで判定可能
  const isReportPage = pathname === "/report" || pathname.startsWith("/report/");

  return (
    <AuthGuard skipAuth={isReportPage}>
      {isLoginPage || isReportPage ? (
        children
      ) : (
        <RoleProvider>
          <ShopProvider>
            <Header />
            <div className="flex w-full">
              <Sidebar />
              <main className="w-full lg:w-[85%] lg:ml-[15%] min-w-0 min-h-screen px-4 pb-4 lg:px-6 lg:pb-6" style={{ paddingTop: 76 }}>
                <RoleGuard>{children}</RoleGuard>
              </main>
            </div>
            <FloatingTasks />
          </ShopProvider>
        </RoleProvider>
      )}
    </AuthGuard>
  );
}
