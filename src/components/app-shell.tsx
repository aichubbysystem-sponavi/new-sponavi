"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Sidebar from "@/components/sidebar";
import Header from "@/components/header";
import AuthGuard from "@/components/auth-guard";
import RoleProvider from "@/components/role-provider";
import RoleGuard from "@/components/role-guard";
import ShopProvider from "@/components/shop-provider";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [isReportSubdomain, setIsReportSubdomain] = useState(false);

  useEffect(() => {
    setIsReportSubdomain(window.location.hostname.startsWith("report."));
  }, []);

  const isLoginPage = pathname === "/login";
  const isReportPage = pathname === "/report" || pathname.startsWith("/report/") || isReportSubdomain;

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
              <main className="w-full lg:w-[85%] lg:ml-[15%] min-w-0 pt-[60px] min-h-screen p-4 lg:p-6">
                <RoleGuard>{children}</RoleGuard>
              </main>
            </div>
          </ShopProvider>
        </RoleProvider>
      )}
    </AuthGuard>
  );
}
