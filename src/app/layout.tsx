import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import AppShell from "@/components/app-shell";

export const metadata: Metadata = {
  title: {
    default: "SPOTLIGHT NAVIGATOR",
    template: "%s | SPOTLIGHT NAVIGATOR",
  },
  description: "MEO対策総合管理プラットフォーム by 株式会社Chubby",
  robots: { index: false, follow: false },  // 管理画面なので検索エンジンに載せない
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = headers();
  const host = headersList.get("host") || "";
  const isReportDomain = host.startsWith("report.");
  const isPmaxDomain = host.startsWith("p-max.");

  return (
    <html lang="ja">
      <body className="antialiased bg-white text-[#324567]">
        <AppShell isReportDomain={isReportDomain} isPmaxDomain={isPmaxDomain}>{children}</AppShell>
      </body>
    </html>
  );
}
