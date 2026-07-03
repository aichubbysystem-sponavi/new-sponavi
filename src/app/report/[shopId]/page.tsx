import ReportDataLoader from "./data-loader";

export const revalidate = 0;

/**
 * レポートページ。
 * 以前はここ（サーバーコンポーネント）で getReportData を実行し、実データを
 * HTMLに埋め込んでいたため、未ログインでも curl 等で全店舗レポートを取得できた。
 * データ取得は認証付きの /api/report/data 経由に一本化し、ここではシェルのみを描画する。
 */
export default function ReportPage({
  params,
  searchParams,
}: {
  params: { shopId: string };
  searchParams: { month?: string };
}) {
  const shopId = decodeURIComponent(params.shopId);
  const targetMonth = searchParams.month || undefined;
  return <ReportDataLoader shopId={shopId} targetMonth={targetMonth} />;
}
