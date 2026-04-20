import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const SHEETS = [
  { id: "1JpehMxL2I-fgef1sckNaY8RIUDIknvmT2OqhHj0my1k", label: "Sheet1" },
  { id: "10hvP7iSEyst0Bp_96eVsjicM4_qxVfG0BmMkDgFyg-Q", label: "Sheet2" },
];
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "エミナルクリニック 旭川院";

  // ranking-keywords APIを内部呼び出し
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  try {
    const res = await fetch(`${baseUrl}/api/report/ranking-keywords?shopName=${encodeURIComponent(shopName)}`, {
      headers: { "Content-Type": "application/json", "x-internal-call": "1" },
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json({ shopName, status: res.status, data });
  } catch (e: any) {
    return NextResponse.json({ shopName, error: e?.message });
  }
}
