import { NextRequest, NextResponse } from "next/server";
import { getGbpDataForShop } from "@/lib/pmax-sheet";
import { requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "manager"]);
  if (r.error) return r.error;

  const { searchParams } = request.nextUrl;
  const shopName = searchParams.get("shopName");
  const month = searchParams.get("month") || undefined;

  if (!shopName) {
    return NextResponse.json(
      { error: "shopName は必須です" },
      { status: 400 }
    );
  }

  try {
    const data = await getGbpDataForShop(shopName, month);
    return NextResponse.json({ data });
  } catch (error: unknown) {
    console.error("Failed to get GBP data:", error);
    return NextResponse.json(
      { error: "GBPデータの取得に失敗しました" },
      { status: 500 }
    );
  }
}
