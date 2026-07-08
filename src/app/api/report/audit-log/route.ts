import { NextRequest, NextResponse } from "next/server";
import { getSupabase, verifyAuth } from "@/lib/supabase";
import { requirePermission } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/audit-log — 操作ログの閲覧（社長のみ）
 * クエリ: user(部分一致) / actionType / shop(部分一致) / from / to (YYYY-MM-DD)
 *        page / pageSize(既定50, 最大200) / format=csv（上限10,000件）
 */
export async function GET(request: NextRequest) {
  const r = await requirePermission(request, "ADMIN");
  if (r.error) return r.error;

  const sp = request.nextUrl.searchParams;
  const user = (sp.get("user") || "").slice(0, 100);
  const actionType = (sp.get("actionType") || "").slice(0, 30);
  const shop = (sp.get("shop") || "").slice(0, 200);
  const from = sp.get("from") || "";
  const to = sp.get("to") || "";
  const isCsv = sp.get("format") === "csv";
  const page = Math.max(1, parseInt(sp.get("page") || "1", 10) || 1);
  const pageSize = Math.min(200, Math.max(1, parseInt(sp.get("pageSize") || "50", 10) || 50));

  const sb = getSupabase();
  let query = sb.from("audit_logs").select("*", { count: "exact" });
  if (user) query = query.ilike("user_name", `%${user}%`);
  if (actionType) query = query.eq("action_type", actionType);
  if (shop) query = query.ilike("target_shop", `%${shop}%`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("created_at", `${from}T00:00:00+09:00`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("created_at", `${to}T23:59:59+09:00`);
  query = query.order("created_at", { ascending: false });

  if (isCsv) {
    const { data, error } = await query.limit(10000);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const header = ["日時", "ユーザー", "ロール", "操作", "種別", "対象店舗", "詳細", "メソッド", "パス", "IP", "結果", "記録元"];
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = (data || []).map((l) => [
      new Date(l.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
      l.user_name, l.role, l.action, l.action_type, l.target_shop, l.detail,
      l.method, l.path, l.ip, l.status, l.source,
    ].map(esc).join(","));
    // UTF-8 BOM付き（Excelの文字化け防止）
    const csv = "﻿" + [header.join(","), ...lines].join("\r\n");
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const fromIdx = (page - 1) * pageSize;
  const { data, count, error } = await query.range(fromIdx, fromIdx + pageSize - 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data || [], total: count ?? 0, page, pageSize });
}

/**
 * POST /api/report/audit-log
 * 操作ログを記録する。
 * 以前は anonキーで audit_logs へ直接 insert しており、user_name もクライアント算出値だった
 * ため、監査ログを匿名で偽造・注入できた。ここでは検証済みJWTの sub から
 * サーバー側で user_name を解決し、クライアント指定の名前は信用しない。
 * body: { action, detail }
 */
export async function POST(request: NextRequest) {
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || "").slice(0, 200);
  const detail = String(body?.detail || "").slice(0, 2000);
  if (!action) return NextResponse.json({ error: "actionが必要です" }, { status: 400 });

  const supabase = getSupabase();

  // ユーザー名はサーバー側で解決（クライアント値は使わない）
  let userName = "不明";
  const { data: byAuthUid } = await supabase
    .from("user_profiles").select("name").eq("auth_uid", auth.sub).maybeSingle();
  if (byAuthUid?.name) {
    userName = byAuthUid.name;
  } else {
    const { data: byId } = await supabase
      .from("user_profiles").select("name").eq("id", auth.sub).maybeSingle();
    if (byId?.name) userName = byId.name;
  }

  const { error } = await supabase.from("audit_logs").insert({
    id: crypto.randomUUID(),
    user_name: userName,
    user_id: auth.sub,
    action,
    detail,
    source: "client",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
