import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "レポート | SPOTLIGHT NAVIGATOR",
  description: "MEO対策レポート",
};

export default function ReportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@300;400;500;700;900&display=swap');
            @media print {
              body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
              .no-print { display: none !important; }
              .slide { margin: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
              @page { size: landscape; margin: 0; }
            }
          `,
        }}
      />
      {children}
    </>
  );
}
