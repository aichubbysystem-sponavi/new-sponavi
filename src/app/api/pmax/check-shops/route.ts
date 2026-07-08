/**
 * POST /api/pmax/check-shops
 * 指定した店舗名リストがDBの指定月に存在するか照合
 * body: { shopNames: string[], month: "YYYY-MM" }
 */
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

function norm(s: string) {
  return s.toLowerCase().replace(/[\s\u3000]+/g, "").replace(/[（）()【】&＆]/g, "");
}

export const POST = withAudit("P-MAX店舗突合", "DATA_OP", async (request, ctx) => {
  const { shopNames, month } = await request.json();
  if (!shopNames || !month) {
    return NextResponse.json({ error: "shopNames, month 必須" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data: allRows } = await sb
    .from("pmax_store_data")
    .select("shop_name")
    .limit(50000);

  // 対象月のユニーク店舗名
  const dbShops = Array.from(new Set((allRows || []).map((r: { shop_name: string }) => r.shop_name)));
  const dbNorm = new Map(dbShops.map(s => [norm(s), s]));

  const found: { input: string; dbName: string }[] = [];
  const notFound: string[] = [];

  for (const name of shopNames) {
    const n = norm(name);
    // 完全一致
    if (dbNorm.has(n)) {
      found.push({ input: name, dbName: dbNorm.get(n)! });
      continue;
    }
    // 部分一致
    let matched = false;
    for (const entry of Array.from(dbNorm.entries())) {
      const [dn, ds] = entry;
      if (dn.length >= 4 && n.length >= 4 && (dn.includes(n) || n.includes(dn))) {
        found.push({ input: name, dbName: ds });
        matched = true;
        break;
      }
    }
    if (!matched) notFound.push(name);
  }

  ctx.detail = `${month}: ${shopNames.length}件を照合（一致${found.length}件 / 不一致${notFound.length}件）`;
  return NextResponse.json({
    month,
    totalDbShops: dbShops.length,
    checked: shopNames.length,
    found: found.length,
    notFound: notFound.length,
    notFoundList: notFound,
    foundList: found,
  });
});
