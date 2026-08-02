import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
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
 * POST /api/report/audit-log — 廃止（410）。
 * 監査ログの記録はサーバー側の withAudit / writeAudit が行う。
 */
export async function POST() {
  // 【廃止】2026-08-02のレビュー指摘により無効化。
  // クライアントから任意の action/detail を書き込めたため、ログインできる誰でも
  // （バイト権限でも）「ユーザー削除」等の偽エントリを注入して、
  // 自分の実操作の記録を埋没させられる状態だった。
  // 実際の監査ログはサーバー側の withAudit / writeAudit（source='server'）が書いており、
  // この経路を呼ぶコードは存在しない。
  // 将来クライアント発の記録が必要になったら、記録できる action を固定の許可リストにすること。
  return NextResponse.json(
    { error: "この経路は廃止されました。監査ログはサーバー側で自動記録されます" },
    { status: 410 },
  );
}
