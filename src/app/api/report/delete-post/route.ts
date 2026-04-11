import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

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
  const { data } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
  if (!data) return null;
  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token" }),
    });
    if (!res.ok) return data.access_token;
    const t = await res.json();
    await getSupabase().from("system_oauth_tokens").update({
      access_token: t.access_token,
      expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    }).not("account_id", "is", null);
    return t.access_token;
  } catch { return data.access_token; }
}

/**
 * POST /api/report/delete-post
 * GBP投稿を削除
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const { postName } = await request.json();
  if (!postName) return NextResponse.json({ error: "postNameが必要です" }, { status: 400 });

  const accessToken = await getOAuthToken();
  if (!accessToken) return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });

  // postName = accounts/xxx/locations/yyy/localPosts/zzz
  const name = postName.startsWith("accounts/") ? postName
    : `accounts/111148362910776147900/${postName}`;

  try {
    const res = await fetch(`${GBP_API_BASE}/${name}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      return NextResponse.json({ error: `削除失敗 (${res.status}): ${err.slice(0, 200)}` }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "削除に失敗" }, { status: 500 });
  }
}
