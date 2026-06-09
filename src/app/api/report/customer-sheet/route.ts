import { NextRequest, NextResponse } from "next/server";
import { fetchCustomerSheet } from "@/lib/customer-sheet";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  const map = await fetchCustomerSheet();
  const customers = Array.from(map.entries()).map(([key, info]) => ({
    key,
    name: info.name,
    service: info.service,
    status: info.status,
  }));
  return NextResponse.json({ customers, total: customers.length });
}
