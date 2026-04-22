import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/**
 * GET /api/internal/fixed-messages/[shopId]
 *
 * Go APIから同名店舗のfixed_messagesを検索して返す
 * 認証なしでGo APIを呼ぶことで全店舗にアクセス可能
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shopId: string }> }
) {
  const { shopId } = await params;
  const debug: string[] = [];
  debug.push(`shopId: ${shopId}`);
  debug.push(`GO_API_URL: ${GO_API_URL || "MISSING"}`);

  if (!shopId || !GO_API_URL) {
    return NextResponse.json({ messages: [], debug });
  }

  try {
    // 1. 現在の店舗情報をGo APIから取得（認証付き - リクエストからトークンを転送）
    const authHeader = request.headers.get("authorization") || "";
    const currentShopRes = await fetch(`${GO_API_URL}/api/shop/${shopId}`, {
      headers: authHeader ? { Authorization: authHeader } : {},
      signal: AbortSignal.timeout(10000),
    });

    if (!currentShopRes.ok) {
      debug.push(`currentShop: HTTP ${currentShopRes.status}`);
      return NextResponse.json({ messages: [], debug });
    }

    const currentShop = await currentShopRes.json();
    const shopName = currentShop?.name;
    debug.push(`currentShop: name=${shopName}`);

    // まず現在の店舗にfixed_messagesがあればそれを返す
    if (Array.isArray(currentShop?.fixed_messages) && currentShop.fixed_messages.length > 0) {
      debug.push(`found in current shop: ${currentShop.fixed_messages.length}`);
      return NextResponse.json(currentShop.fixed_messages);
    }

    if (!shopName) {
      return NextResponse.json({ messages: [], debug });
    }

    // 2. Go APIから全店舗リストを認証なしで取得（認証なし→フィルタなし→全店舗）
    const allShopsRes = await fetch(`${GO_API_URL}/api/shop`, {
      // 認証ヘッダーを送らない → 全店舗が返る
      signal: AbortSignal.timeout(15000),
    });

    if (!allShopsRes.ok) {
      debug.push(`allShops: HTTP ${allShopsRes.status}`);
      return NextResponse.json({ messages: [], debug });
    }

    const allShops: any[] = await allShopsRes.json();
    debug.push(`allShops: total=${allShops.length}`);

    // 3. 同名店舗を検索
    const matchingShops = allShops.filter((s: any) => s.name === shopName && s.id !== shopId);
    debug.push(`matchingShops: ${matchingShops.length}, ids=${JSON.stringify(matchingShops.map((s: any) => s.id))}`);

    // 4. 各マッチング店舗の詳細（fixed_messages付き）を取得
    for (const match of matchingShops) {
      try {
        const detailRes = await fetch(`${GO_API_URL}/api/shop/${match.id}`, {
          // 認証なし
          signal: AbortSignal.timeout(10000),
        });
        if (!detailRes.ok) {
          debug.push(`detail ${match.id}: HTTP ${detailRes.status}`);
          continue;
        }
        const detail = await detailRes.json();
        if (Array.isArray(detail?.fixed_messages) && detail.fixed_messages.length > 0) {
          debug.push(`found in ${match.id}: ${detail.fixed_messages.length} messages`);
          return NextResponse.json(detail.fixed_messages);
        }
        debug.push(`detail ${match.id}: fixed_messages empty`);
      } catch (e: any) {
        debug.push(`detail ${match.id}: error ${e?.message}`);
      }
    }

    return NextResponse.json({ messages: [], debug });
  } catch (e: any) {
    debug.push(`exception: ${e?.message}`);
    return NextResponse.json({ error: e?.message, debug }, { status: 500 });
  }
}
