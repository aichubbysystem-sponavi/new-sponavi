import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "レポート | SPOTLIGHT NAVIGATOR",
  description: "MEO対策レポート by 株式会社Chubby",
};

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {/* Google Fonts: Noto Sans JP */}
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="preconnect"
        href="https://fonts.googleapis.com"
        crossOrigin="anonymous"
      />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        rel="preconnect"
        href="https://fonts.gstatic.com"
        crossOrigin="anonymous"
      />
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link
        href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700;900&display=swap"
        rel="stylesheet"
      />
      <style
        dangerouslySetInnerHTML={{
          __html: `
            /* 画面: 非アクティブKWスライドをオフスクリーンに配置 */
            .grid-kw-hidden {
              position: absolute !important;
              left: -99999px !important;
              pointer-events: none !important;
            }

            @page { size: A4 landscape; margin: 0; }

            @media print {
              * {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
              .no-print { display: none !important; }
              .slide { margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }

              /* print用スライドを表示 */
              .grid-print-slide {
                display: flex !important;
              }
              /* 全KW比較: 2つ目以降は非表示（1ページ目のみ表示） */
              .grid-kw-comparison-sub {
                display: none !important;
              }
            }
          `,
        }}
      />
      {children}
    </>
  );
}
