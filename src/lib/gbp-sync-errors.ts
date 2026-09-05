/**
 * GBP同期の失敗理由を店舗×種別で1行保持する（gbp_sync_errors）
 * これまで検索語句・指標の失敗は console.log にしか出ず、画面は「同期失敗0」に見えていた。
 * 成功時は行を削除する＝「行がある＝直近の同期が失敗」。
 */
import { getSupabase } from "@/lib/supabase";

export type GbpSyncKind = "search_keywords" | "performance";

export interface GbpSyncError {
  kind: GbpSyncKind;
  http_status: number;
  message: string;
  updated_at: string;
}

/** HTTPステータス → 画面向けの短い理由 */
export function describeGbpFailure(status: number, errorText?: string): string {
  switch (status) {
    case 401: return "認証エラー(401)";
    case 403: return "権限なし(403): 全トークンでアクセス不可";
    case 404: return "ロケーション不可視(404): 全トークンで見つからず";
    case 429: return "レート制限(429)";
    case 0: return `ネットワーク/タイムアウト${errorText ? `: ${errorText.slice(0, 80)}` : ""}`;
    default: return `HTTP ${status}${errorText ? `: ${errorText.slice(0, 80)}` : ""}`;
  }
}

export async function recordGbpSyncError(
  shopId: string,
  shopName: string,
  kind: GbpSyncKind,
  httpStatus: number,
  message: string
): Promise<void> {
  try {
    const { error } = await getSupabase().from("gbp_sync_errors").upsert({
      shop_id: shopId,
      shop_name: shopName,
      kind,
      http_status: httpStatus,
      message: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }, { onConflict: "shop_id,kind" });
    if (error) console.error("[gbp-sync-errors] upsert failed:", error.message);
  } catch (e: any) {
    console.error("[gbp-sync-errors] upsert error:", e?.message);
  }
}

export async function clearGbpSyncError(shopId: string, kind: GbpSyncKind): Promise<void> {
  try {
    const { error } = await getSupabase().from("gbp_sync_errors")
      .delete().eq("shop_id", shopId).eq("kind", kind);
    if (error) console.error("[gbp-sync-errors] delete failed:", error.message);
  } catch (e: any) {
    console.error("[gbp-sync-errors] delete error:", e?.message);
  }
}

/** kind 単位で全件（shop_id → error） */
export async function getGbpSyncErrors(kind: GbpSyncKind): Promise<Map<string, GbpSyncError>> {
  const map = new Map<string, GbpSyncError>();
  try {
    const { data, error } = await getSupabase().from("gbp_sync_errors")
      .select("shop_id, kind, http_status, message, updated_at").eq("kind", kind);
    if (error) { console.error("[gbp-sync-errors] select failed:", error.message); return map; }
    for (const r of data || []) map.set(r.shop_id, r as GbpSyncError);
  } catch (e: any) {
    console.error("[gbp-sync-errors] select error:", e?.message);
  }
  return map;
}
