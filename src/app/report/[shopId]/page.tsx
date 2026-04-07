import { mockReportData } from "@/lib/report-data";
import { notFound } from "next/navigation";
import ReportClient from "./client";

export default function ReportPage({
  params,
}: {
  params: { shopId: string };
}) {
  const data = mockReportData[params.shopId];
  if (!data) {
    notFound();
  }

  return <ReportClient data={data} shopId={params.shopId} />;
}
