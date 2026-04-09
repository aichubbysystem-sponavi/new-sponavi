import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry")
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const expiry = new Date(data.expiry);
  if (expiry.getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;

  // リフレッシュ
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
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

    await fetch(`${SUPABASE_URL}/rest/v1/tokens?account_id=not.is.null`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY}`,
        "Content-Profile": "system",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        access_token: tokenData.access_token,
        expiry: new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString(),
      }),
    });

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
  const parent = locationName.startsWith("accounts/")
    ? locationName
    : `accounts/111148362910776147900/${locationName}`;

  const allMedia: MediaItem[] = [];
  let nextPageToken: string | undefined;

  do {
    const params = new URLSearchParams({ pageSize: "100" });
    if (nextPageToken) params.set("pageToken", nextPageToken);

    const res = await fetch(`${GBP_API_BASE}/${parent}/media?${params}`, {
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
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
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
        view_count: parseInt(m.insights?.viewCount || "0", 10) || 0,
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
