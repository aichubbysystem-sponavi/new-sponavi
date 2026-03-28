import type { Metadata } from "next";
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
  return (
    <html lang="ja">
      <body className="antialiased bg-white text-[#324567]">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
