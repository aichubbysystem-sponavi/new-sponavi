import { NextResponse } from "next/server";
import { fetchCustomerSheet } from "@/lib/customer-sheet";

export const dynamic = "force-dynamic";

export async function GET() {
  const map = await fetchCustomerSheet();
  const customers = Array.from(map.entries()).map(([key, info]) => ({
    key,
    name: info.name,
    service: info.service,
    status: info.status,
  }));
  return NextResponse.json({ customers, total: customers.length });
}
