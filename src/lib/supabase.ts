import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// ── 環境変数 ──
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "環境変数が設定されていません。.env.local に NEXT_PUBLIC_SUPABASE_URL と NEXT_PUBLIC_SUPABASE_ANON_KEY を設定してください。"
  );
}

// ── Supabaseクライアント（シングルトン） ──

/** フロントエンド用（Anon Key） */
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** サーバー用（Service Role Key。RLSバイパス） */
let _adminClient: SupabaseClient | null = null;
export function getSupabase(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
  }
  return _adminClient;
}

// ── 認証ヘルパー ──

/** APIルート用: Bearer tokenからSupabase Authユーザーを検証 */
export async function verifyAuth(authHeader: string | null): Promise<{ valid: boolean; sub?: string }> {
  if (!authHeader?.startsWith("Bearer ")) return { valid: false };
  const token = authHeader.replace("Bearer ", "");

  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return { valid: false };
    return { valid: true, sub: data.user.id };
  } catch {
    return { valid: false };
  }
}

/** Cronルート用: CRON_SECRETのBearerトークンを検証 */
export function verifyCron(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

/** APIルート用: 認証チェック → 失敗時は401レスポンスを返す */
export async function requireAuth(request: NextRequest): Promise<{ auth: { valid: true; sub: string }; error?: never } | { auth?: never; error: NextResponse }> {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  }
  return { auth: { valid: true, sub: auth.sub } };
}

// ── ロール別アクセス制御 ──

export type AppRole = "president" | "manager" | "part_time";

/**
 * ユーザーIDからロールを取得
 * 1. user_profiles.role を検索
 * 2. 見つからなければ Supabase Auth の user_metadata.role にフォールバック
 */
export async function getUserRole(userId: string): Promise<AppRole | null> {
  const sb = getSupabase();

  // 1. user_profiles から取得
  const { data } = await sb
    .from("user_profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (data?.role) return data.role as AppRole;

  // 2. フォールバック: Supabase Auth の user_metadata.role
  try {
    const { data: authData } = await sb.auth.admin.getUserById(userId);
    const metaRole = authData?.user?.user_metadata?.role as string | undefined;
    if (metaRole && ["president", "manager", "part_time"].includes(metaRole)) {
      return metaRole as AppRole;
    }
  } catch {
    // admin API失敗時は無視
  }

  return null;
}

/**
 * 認証 + ロールチェックを一括で行うヘルパー
 * @param request リクエスト
 * @param allowedRoles 許可するロールの配列（例: ["president", "manager"]）
 * @returns 成功時は { sub, role }、失敗時は NextResponse（401 or 403）
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: AppRole[],
): Promise<{ sub: string; role: AppRole; error?: never } | { sub?: never; role?: never; error: NextResponse }> {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  }
  const role = await getUserRole(auth.sub);
  if (!role || !allowedRoles.includes(role)) {
    return { error: NextResponse.json({ error: "この操作を行う権限がありません" }, { status: 403 }) };
  }
  return { sub: auth.sub, role };
}
