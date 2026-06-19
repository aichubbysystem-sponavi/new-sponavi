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
            @media print {
              body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
              .no-print { display: none !important; }
              .slide { margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
              @page { size: landscape; margin: 0; }

              /* 多地点順位: PDF時は2KW/ページ */
              .grid-kw-pair {
                page-break-after: always !important;
                page-break-inside: avoid !important;
              }
              .grid-kw-slide {
                height: 397px !important;
                page-break-after: avoid !important;
                page-break-inside: avoid !important;
                overflow: hidden !important;
              }
              .grid-kw-header {
                padding: 6px 9px !important;
                font-size: 13px !important;
              }
              .grid-kw-body {
                padding: 8px 9px !important;
                gap: 4px !important;
              }
              .grid-kw-title {
                font-size: 14px !important;
                margin-bottom: 4px !important;
              }
              .grid-kw-content {
                gap: 10px !important;
              }
              .grid-map-container {
                width: 300px !important;
                height: 270px !important;
              }
              .grid-kw-legend {
                font-size: 10px !important;
                gap: 6px !important;
                margin-top: 1px !important;
              }
              .grid-kw-legend span span:first-child {
                width: 7px !important;
                height: 7px !important;
              }
              .grid-kw-avg {
                font-size: 12px !important;
              }
              .grid-kw-avg span {
                font-size: 16px !important;
              }
              .grid-kw-tables h4 {
                font-size: 12px !important;
              }
              .grid-kw-tables th,
              .grid-kw-tables td {
                padding: 4px 4px !important;
                font-size: 12px !important;
              }
              .grid-kw-comparison th,
              .grid-kw-comparison td {
                padding: 3px 6px !important;
                font-size: 11px !important;
              }
              .grid-kw-comparison h4 {
                margin-top: 2px !important;
                font-size: 11px !important;
              }
            }
          `,
        }}
      />
      {children}
    </>
  );
}
