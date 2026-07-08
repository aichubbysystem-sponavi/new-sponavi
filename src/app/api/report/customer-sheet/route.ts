import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/supabase";
import { fetchCustomerSheet } from "@/lib/customer-sheet";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // 顧客マスタ（契約情報）は社長・社員のみ
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;
  const map = await fetchCustomerSheet();
  const customers = Array.from(map.entries()).map(([key, info]) => ({
    key,
    name: info.name,
    service: info.service,
    status: info.status,
  }));
  return NextResponse.json({ customers, total: customers.length });
}
