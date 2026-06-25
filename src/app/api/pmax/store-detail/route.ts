import { NextRequest, NextResponse } from "next/server";
import { getStoreDetail } from "@/lib/google-ads";
import { requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/pmax/store-detail?shopName=X&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 * 特定店舗の言語別キャンペーンデータ（月次+日次）を返す
 */
export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const shopName = searchParams.get("shopName");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");

  if (!shopName || !startDate || !endDate) {
    return NextResponse.json({ error: "shopName, startDate, endDate は必須です" }, { status: 400 });
  }

  try {
    const data = await getStoreDetail(shopName, startDate, endDate);
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("[pmax/store-detail] Error:", error);
    return NextResponse.json({ error: "店舗詳細の取得に失敗しました" }, { status: 500 });
  }
}
