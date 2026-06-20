import { NextRequest, NextResponse } from "next/server";
import { getGbpDataForShop } from "@/lib/pmax-sheet";
import { verifyAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

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
