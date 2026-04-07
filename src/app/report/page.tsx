import { getShopList } from "@/lib/report-api";
import ReportListClient from "./report-list-client";

export const dynamic = "force-dynamic";

export default async function ReportListPage() {
  const { shops, source } = await getShopList();

  return <ReportListClient shops={shops} source={source} />;
}
