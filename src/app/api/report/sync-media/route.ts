import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit, requireCtxShopAccess } from "@/lib/audit";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

interface MediaItem {
  name: string;
  mediaFormat: string;
  googleUrl?: string;
  thumbnailUrl?: string;
  createTime?: string;
  description?: string;
  locationAssociation?: { category?: string };
  insights?: { viewCount?: string };
}

async function fetchMedia(locationName: string, accessToken: string): Promise<MediaItem[]> {
  let parent = locationName;
  if (!locationName.startsWith("accounts/")) {
    const { resolveLocationName } = await import("@/lib/gbp-location");
    parent = await resolveLocationName(locationName) || locationName;
  }

  const allMedia: MediaItem[] = [];
  let nextPageToken: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(`${GBP_API_BASE}/${parent}/media?${params}`, {
      cache: "no-store" as const,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) break;

    const data = await res.json();
    if (data.mediaItems) allMedia.push(...data.mediaItems);
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);

  return allMedia;
}

export const POST = withAudit("メディア同期", "DATA_OP", async (request, ctx) => {
  const body = await request.json().catch(() => ({}));
  const shopIds: string[] = body.shopIds || [];

  // 認可チェック: 指定店舗へのアクセス権を検証
  if (shopIds.length > 0) {
    const sb = getSupabase();
    const { data: shops } = await sb.from("shops").select("name").in("id", shopIds);
    for (const shop of shops || []) {
      const shopErr = await requireCtxShopAccess(ctx, shop.name);
      if (shopErr) return shopErr;
    }
  }

  const accessToken = await getOAuthToken();
  if (!accessToken) {
    return NextResponse.json({ error: "OAuthトークンが見つかりません" }, { status: 500 });
  }

  const supabase = getSupabase();

  let query = supabase.from("shops").select("id, name, gbp_location_name").not("gbp_location_name", "is", null);
  if (shopIds.length > 0) query = query.in("id", shopIds);
  const { data: shops } = await query;

  if (!shops) return NextResponse.json({ error: "店舗取得失敗" }, { status: 500 });

  let totalSynced = 0;

  for (const shop of shops) {
    if (!shop.gbp_location_name) continue;
    try {
      const media = await fetchMedia(shop.gbp_location_name, accessToken);
      if (media.length === 0) continue;

      const rows = media.map((m) => ({
        shop_id: shop.id,
        shop_name: shop.name,
        media_name: m.name,
        google_url: m.googleUrl || null,
        thumbnail_url: m.thumbnailUrl || null,
        category: m.locationAssociation?.category || "ADDITIONAL",
        view_count: Math.max(0, parseInt(m.insights?.viewCount || "0", 10) || 0),
        description: m.description || null,
        create_time: m.createTime || null,
        synced_at: new Date().toISOString(),
      }));

      for (let i = 0; i < rows.length; i += 50) {
        await supabase.from("media").upsert(rows.slice(i, i + 50), { onConflict: "media_name" });
      }

      totalSynced += media.length;
    } catch (err) {
      console.error(`[sync-media] Error for ${shop.name}:`, err);
    }
  }

  ctx.detail = `対象${shops.length}店舗: メディア${totalSynced}件同期`;
  return NextResponse.json({ success: true, shops: shops.length, totalSynced });
});
