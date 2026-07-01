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
    // モジュールレベル定数ではなく、実行時に環境変数を直接読む
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!serviceKey) {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY が未設定です。Vercel環境変数を確認してください。");
    }
    const isServiceKey = serviceKey.startsWith("eyJ") && serviceKey.length > 200;
    console.error(`[getSupabase] key prefix=${serviceKey.slice(0, 20)}..., len=${serviceKey.length}, isServiceKey=${isServiceKey}`);
    _adminClient = createClient(SUPABASE_URL, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
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

  // user_profiles を全件取得してJSで検索（.eq()フィルターがPostgRESTで不安定なため）
  const { data: profiles } = await sb.from("user_profiles").select("id, auth_uid, role");
  if (profiles && profiles.length > 0) {
    const match = profiles.find(
      (p: { id: string; auth_uid: string }) => p.id === userId || p.auth_uid === userId
    );
    if (match?.role) return match.role as AppRole;
  }

  console.warn(`[getUserRole] Role not found for userId: ${userId}`);
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

// ── 店舗アクセス制御 ──

/**
 * ユーザーがアクセス可能な店舗名一覧を取得
 * - president: "all"（全店舗）
 * - その他: user_shop_access テーブルに登録された店舗名のみ
 */
export async function getUserAllowedShops(authUid: string): Promise<string[] | "all"> {
  const role = await getUserRole(authUid);
  if (role === "president") return "all";

  const sb = getSupabase();
  const { data } = await sb
    .from("user_shop_access")
    .select("shop_name")
    .eq("auth_uid", authUid);
  return (data || []).map((r: { shop_name: string }) => r.shop_name);
}

/**
 * ユーザーが特定店舗にアクセスできるか検証
 */
export async function verifyShopAccess(authUid: string, shopName: string): Promise<boolean> {
  const allowed = await getUserAllowedShops(authUid);
  if (allowed === "all") return true;
  // 正規化して比較（全角/半角・大小文字の揺れ対応）
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "");
  return allowed.some((name) => norm(name) === norm(shopName));
}

/**
 * APIルート用: 認証 + 店舗アクセスチェックを一括で行うヘルパー
 */
export async function requireShopAccess(
  request: NextRequest,
  shopName: string,
): Promise<{ sub: string; error?: never } | { sub?: never; error: NextResponse }> {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  }
  const hasAccess = await verifyShopAccess(auth.sub, shopName);
  if (!hasAccess) {
    return { error: NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 }) };
  }
  return { sub: auth.sub };
}

/**
 * APIルート用: 認証 + shopId→店舗名解決 + 店舗アクセスチェック
 * shopIdベースのAPIで使用
 */
export async function requireShopAccessById(
  request: NextRequest,
  shopId: string,
): Promise<{ sub: string; shopName: string; error?: never } | { sub?: never; shopName?: never; error: NextResponse }> {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  }
  const sb = getSupabase();
  const { data: shop } = await sb.from("shops").select("name").eq("id", shopId).maybeSingle();
  if (!shop?.name) {
    return { error: NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 }) };
  }
  const hasAccess = await verifyShopAccess(auth.sub, shop.name);
  if (!hasAccess) {
    return { error: NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 }) };
  }
  return { sub: auth.sub, shopName: shop.name };
}
