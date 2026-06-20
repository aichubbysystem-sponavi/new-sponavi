import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";


async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_oauth_tokens")
    .select("account_id, access_token, refresh_token, expiry")
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const expiry = new Date(data.expiry);
  if (expiry.getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;

  // リフレッシュ
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      cache: "no-store" as const,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GBP_CLIENT_ID,
        client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return data.access_token;
    const tokenData = await res.json();

    const updateData = {
      access_token: tokenData.access_token,
      expiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
    };
    if (data.account_id) {
      await getSupabase().from("system_oauth_tokens").update(updateData).eq("account_id", data.account_id);
    } else {
      await getSupabase().from("system_oauth_tokens").update(updateData).eq("refresh_token", data.refresh_token);
    }

    return tokenData.access_token;
  } catch {
    return data.access_token;
  }
}

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

export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const shopIds: string[] = body.shopIds || [];

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

  return NextResponse.json({ success: true, shops: shops.length, totalSynced });
}
