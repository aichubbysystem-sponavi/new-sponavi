import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shop") || "エミナルクリニック 旭川院";
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const apiUrl = `${baseUrl}/api/report/ranking-keywords?shopName=${encodeURIComponent(shopName)}`;

  let fetchResult: any = null;
  let fetchError: string | null = null;
  let fetchStatus = 0;

  try {
    const res = await fetch(apiUrl, {
      headers: { "Content-Type": "application/json", "x-internal-call": "1" },
      cache: "no-store",
    });
    fetchStatus = res.status;
    const text = await res.text();
    try { fetchResult = JSON.parse(text); } catch { fetchResult = text.slice(0, 500); }
  } catch (e: any) {
    fetchError = e?.message || String(e);
  }

  return NextResponse.json({
    shopName,
    baseUrl,
    apiUrl,
    fetchStatus,
    fetchError,
    ranksCount: fetchResult?.ranks?.length ?? 0,
    found: fetchResult?.found ?? false,
    fetchResultPreview: fetchResult ? JSON.stringify(fetchResult).slice(0, 300) : null,
  });
}
