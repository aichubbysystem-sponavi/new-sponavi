import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "@/lib/supabase";
import { getMonthlyActivity, type ShopRef } from "@/lib/gbp-activity";
import { normalizeMonthLabel } from "@/lib/month-utils";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * インスタンス内キャッシュ。
 * 同じレポートを開き直す・PDFのために再読込する・複数人で同じ月を見る、といったときに
 * GBP APIを叩き直さないため。写真URLは失効するので長くは持てない。
 */
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_LIMIT = 500;
const cache = new Map<string, { at: number; payload: unknown }>();

function readCache(key: string): unknown | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.payload;
}

function writeCache(key: string, payload: unknown) {
  cache.set(key, { at: Date.now(), payload });
  if (cache.size > CACHE_LIMIT) {
    const oldest = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at);
    for (const [k] of oldest.slice(0, Math.floor(oldest.length / 2))) cache.delete(k);
  }
}

/**
 * GET /api/report/activity?shopId=<店舗名>&month=YYYY/M
 *
 * レポートの「先月の実施内容」ページ用。
 *   投稿数 / 口コミ返信件数 / 写真投稿枚数（いずれも前月比つき）と、
 *   その月に投稿した写真のURLを返す。
 *
 * shopId はレポート全体と同じく「店舗名」（ShopListItem.id = 店舗名）。
 */
export async function GET(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const shopIdParam = request.nextUrl.searchParams.get("shopId");
  const monthParam = request.nextUrl.searchParams.get("month");
  if (!shopIdParam) return NextResponse.json({ error: "shopIdが必要です" }, { status: 400 });

  const month = normalizeMonthLabel(monthParam || "");
  if (!month) return NextResponse.json({ error: "monthが不正です（YYYY/M）" }, { status: 400 });

  // 店舗名はNFCで保存されている。Go API等がNFDを返す経路があるため正規化して照合する
  const shopName = decodeURIComponent(shopIdParam).normalize("NFC");

  if (!(await verifyShopAccess(auth.sub, shopName))) {
    return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
  }

  const supabase = getSupabase();
  // 同名店舗が実在するため maybeSingle は使わない。GBP連携済みの行を優先する
  const { data: rows, error } = await supabase
    .from("shops")
    .select("id, name, gbp_location_name")
    .eq("name", shopName)
    .limit(5);

  if (error) {
    console.error("[report/activity] shops取得失敗:", error.message);
    return NextResponse.json({ error: "店舗の取得に失敗しました" }, { status: 500 });
  }
  const shop = (rows || []).find(r => r.gbp_location_name) || (rows || [])[0];
  if (!shop) return NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 });

  // 権限チェックの後にキャッシュを見る（他店舗のデータをキャッシュ経由で返さないため）
  const cacheKey = `${shop.id}:${month}`;
  const cached = request.nextUrl.searchParams.get("refresh") === "1" ? null : readCache(cacheKey);
  if (cached) return NextResponse.json(cached);

  try {
    const activity = await getMonthlyActivity(shop as ShopRef, month);
    writeCache(cacheKey, activity);
    return NextResponse.json(activity);
  } catch (e: any) {
    // 「0件」と「取得失敗」を画面上で区別できるようにする（握りつぶさない）
    console.error("[report/activity] 集計失敗:", shopName, month, e?.message);
    return NextResponse.json({ error: e?.message || "実施内容の取得に失敗しました" }, { status: 500 });
  }
}
