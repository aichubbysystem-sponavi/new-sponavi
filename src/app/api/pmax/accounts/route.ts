import { NextRequest, NextResponse } from "next/server";
import { listAccounts } from "@/lib/google-ads";
import { requireRole } from "@/lib/supabase";
import { getPmaxCache, setPmaxCache } from "@/lib/pmax-cache";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  const cacheKey = "accounts";
  const cached = await getPmaxCache<{ accounts: unknown[] }>(cacheKey);
  if (cached) return NextResponse.json({ ...cached, cached: true });

  try {
    const accounts = await listAccounts();
    const result = { accounts };
    setPmaxCache(cacheKey, result);
    return NextResponse.json({ ...result, cached: false });
  } catch (error: unknown) {
    console.error("Failed to list accounts:", error);
    return NextResponse.json({ error: "アカウント一覧の取得に失敗しました" }, { status: 500 });
  }
}
