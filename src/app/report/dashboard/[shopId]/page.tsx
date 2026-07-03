import DashboardDataLoader from "./data-loader";

export const dynamic = "force-dynamic";

/**
 * 顧客ダッシュボード。データ取得は認証付きの /api/report/dashboard-data に一本化し、
 * サーバーコンポーネントでは実データをHTMLに埋め込まない（未認証漏洩の防止）。
 */
export default function CustomerDashboardPage({ params }: { params: { shopId: string } }) {
  const shopId = decodeURIComponent(params.shopId);
  return <DashboardDataLoader shopId={shopId} />;
}
