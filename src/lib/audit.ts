/**
 * サーバー側 認可 + 監査ログの単一入口（server-only）
 *
 * 使い方（変更系APIルート）:
 *   export const POST = withAudit("GBP投稿作成", "EXTERNAL_OP", async (request, ctx) => {
 *     const err = await requireCtxShopAccess(ctx, shopName);  // 店舗チェックが必要なら
 *     if (err) return err;
 *     ctx.detail = `${shopName}: ...`;   // 記録したい詳細を随時セット
 *     ...
 *     return NextResponse.json({...});
 *   });
 *
 * 認可(requirePermission)を通った変更操作は、ハンドラの成否にかかわらず
 * 必ず audit_logs に記録される（構造的に記録漏れしない）。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth, verifyShopAccess } from "./supabase";
import type { AppRole, ActionType } from "./permissions";
import { can, isAppRole } from "./permissions";

export interface AuditContext {
  sub: string;
  role: AppRole;
  userName: string;
  method: string;
  path: string;
  ip: string;
  /** ハンドラ内でセットすると監査ログに記録される */
  targetShop?: string;
  /** ハンドラ内でセットすると監査ログの詳細欄に記録される */
  detail?: string;
  /** ハンドラ内でセットすると withAudit の操作名を上書きできる（1ルートで複数操作がある場合） */
  actionOverride?: string;
}

/** user_profiles から role と name を1クエリで取得（auth_uid → id フォールバック） */
async function getRoleAndName(sub: string): Promise<{ role: AppRole; name: string } | null> {
  const sb = getSupabase();
  const { data: byAuthUid } = await sb
    .from("user_profiles").select("role, name").eq("auth_uid", sub).limit(1);
  let row = byAuthUid?.[0];
  if (!row?.role) {
    const { data: byId } = await sb
      .from("user_profiles").select("role, name").eq("id", sub).limit(1);
    row = byId?.[0];
  }
  if (!row?.role || !isAppRole(row.role)) return null;
  return { role: row.role, name: row.name || "不明" };
}

/**
 * 認証 + アクション権限チェック。成功時は監査用コンテキストを返す。
 */
export async function requirePermission(
  request: NextRequest,
  action: ActionType,
): Promise<{ ctx: AuditContext; error?: never } | { ctx?: never; error: NextResponse }> {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return { error: NextResponse.json({ error: "認証が必要です" }, { status: 401 }) };
  }
  const profile = await getRoleAndName(auth.sub);
  if (!profile || !can(profile.role, action)) {
    return { error: NextResponse.json({ error: "この操作を行う権限がありません" }, { status: 403 }) };
  }
  const ctx: AuditContext = {
    sub: auth.sub,
    role: profile.role,
    userName: profile.name,
    method: request.method,
    path: request.nextUrl.pathname,
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip") || "unknown",
  };
  return { ctx };
}

/** ハンドラ内での店舗アクセスチェック（店舗名ベース）。targetShopも記録する */
export async function requireCtxShopAccess(ctx: AuditContext, shopName: string): Promise<NextResponse | null> {
  ctx.targetShop = shopName;
  const ok = await verifyShopAccess(ctx.sub, shopName);
  if (!ok) return NextResponse.json({ error: "この店舗へのアクセス権がありません" }, { status: 403 });
  return null;
}

/** ハンドラ内での店舗アクセスチェック（shopIdベース）。店舗名を解決して返す */
export async function requireCtxShopAccessById(
  ctx: AuditContext,
  shopId: string,
): Promise<{ shopName: string; error?: never } | { shopName?: never; error: NextResponse }> {
  const sb = getSupabase();
  const { data: shop } = await sb.from("shops").select("name").eq("id", shopId).maybeSingle();
  if (!shop?.name) {
    return { error: NextResponse.json({ error: "店舗が見つかりません" }, { status: 404 }) };
  }
  const err = await requireCtxShopAccess(ctx, shop.name);
  if (err) return { error: err };
  return { shopName: shop.name };
}

/**
 * audit_logs へ記録。失敗してもメイン処理を止めない（console.errorのみ）。
 */
export async function writeAudit(
  ctx: AuditContext,
  entry: {
    action: string;
    actionType: ActionType;
    detail?: string;
    status?: number;
    source?: "api" | "middleware" | "client";
  },
): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.from("audit_logs").insert({
      id: crypto.randomUUID(),
      user_name: ctx.userName,
      user_id: ctx.sub,
      role: ctx.role,
      action: entry.action,
      action_type: entry.actionType,
      detail: (entry.detail ?? ctx.detail ?? "").slice(0, 2000),
      target_shop: ctx.targetShop || null,
      method: ctx.method,
      path: ctx.path,
      ip: ctx.ip,
      status: entry.status ?? null,
      source: entry.source || "api",
    });
    if (error) console.error("[writeAudit] insert failed:", error.message);
  } catch (e) {
    console.error("[writeAudit] unexpected:", e);
  }
}

/**
 * 変更系APIハンドラのラッパー: 認可 → 実行 → 監査記録
 */
export function withAudit(
  action: string,
  actionType: ActionType,
  handler: (request: NextRequest, ctx: AuditContext) => Promise<NextResponse>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    const r = await requirePermission(request, actionType);
    if (r.error) return r.error;
    try {
      const res = await handler(request, r.ctx);
      // Vercelのサーバーレスはレスポンス後に処理が凍結されるため await する
      // （writeAudit内部でエラーを握るのでメイン処理は失敗しない）
      await writeAudit(r.ctx, { action: r.ctx.actionOverride ?? action, actionType, status: res.status });
      return res;
    } catch (e) {
      await writeAudit(r.ctx, { action: r.ctx.actionOverride ?? action, actionType, status: 500 });
      throw e;
    }
  };
}
