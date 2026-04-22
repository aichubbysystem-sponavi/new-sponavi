import { getReportData } from "@/lib/report-api";
import { notFound } from "next/navigation";
import ReportClient from "./client";

export const revalidate = 3600; // 1時間キャッシュ（反映ボタンで即時更新）

export default async function ReportPage({
  params,
}: {
  params: { shopId: string };
}) {
  const { data, source } = await getReportData(params.shopId);

  if (!data) {
    notFound();
  }

  return <ReportClient data={data} shopId={params.shopId} dataSource={source} />;
}
