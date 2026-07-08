/**
 * 権限の単一情報源（isomorphic: クライアント/サーバー/edge middleware すべてから import 可）
 * ここに Node API・supabase-js への依存を入れないこと。
 *
 * ロール階層:
 *   president(社長)  … 全操作
 *   executive(幹部)  … API課金がある操作以外は全部OK（GBP外部反映も可）
 *   manager(社員)    … 閲覧 + レポートのメモ追加のみ
 *   part_time(バイト) … 閲覧のみ（割当店舗に限定）
 */

export type AppRole = "president" | "executive" | "manager" | "part_time";

export const ALL_ROLES: AppRole[] = ["president", "executive", "manager", "part_time"];

export function isAppRole(v: unknown): v is AppRole {
  return typeof v === "string" && (ALL_ROLES as string[]).includes(v);
}

/**
 * アクション種別
 * - PAID_OP:      外部API課金が発生する操作（Anthropic AI生成 / Google Places / Google Ads）
 * - EXTERNAL_OP:  お客様のGBPへ公開・反映される操作（投稿・返信・削除・基本情報更新）
 * - DATA_OP:      内部データの変更・同期トリガー・設定保存
 * - MEMO:         レポートのメモ追加（社員に唯一残す変更操作）
 * - ADMIN:        ユーザー管理・店舗アクセス割当・操作ログ閲覧・グループ管理
 * - STAFF_VIEW:   社内向け閲覧API（P-MAX集計等のGET。バイト除外）
 */
export type ActionType =
  | "PAID_OP"
  | "EXTERNAL_OP"
  | "DATA_OP"
  | "MEMO"
  | "ADMIN"
  | "STAFF_VIEW";

export const ACTION_ROLES: Record<ActionType, AppRole[]> = {
  PAID_OP: ["president"],
  EXTERNAL_OP: ["president", "executive"],
  DATA_OP: ["president", "executive"],
  MEMO: ["president", "executive", "manager"],
  ADMIN: ["president"],
  STAFF_VIEW: ["president", "executive", "manager"],
};

/** 指定ロールが指定アクションを実行できるか */
export function can(role: AppRole | null | undefined, action: ActionType): boolean {
  if (!role) return false;
  return ACTION_ROLES[action].includes(role);
}

/** ボタン非活性時のツールチップ文言 */
export const PERMISSION_DENIED_HINT: Record<ActionType, string> = {
  PAID_OP: "この操作はAPI費用が発生するため社長のみ実行できます",
  EXTERNAL_OP: "この操作は幹部以上のみ実行できます",
  DATA_OP: "この操作は幹部以上のみ実行できます",
  MEMO: "メモの追加は社員以上のみ実行できます",
  ADMIN: "この操作は社長のみ実行できます",
  STAFF_VIEW: "この画面は社員以上のみ閲覧できます",
};

/**
 * Goバックエンドプロキシ（next.config.mjs rewrites 経由）の変更系メソッドに
 * middleware で適用するルール。GET には適用しない。
 */
export const GO_PROXY_RULES: { prefix: string; action: ActionType }[] = [
  { prefix: "/api/gbp", action: "EXTERNAL_OP" },
  { prefix: "/api/google", action: "EXTERNAL_OP" },
  { prefix: "/api/shop", action: "DATA_OP" },
  { prefix: "/api/owner", action: "DATA_OP" },
  { prefix: "/api/setting", action: "DATA_OP" },
  { prefix: "/api/group", action: "ADMIN" },
];

/** パスがGoプロキシルールに一致するか（/api/shop と /api/shop/xxx のみ。/api/shopXX は不一致） */
export function matchGoProxyRule(pathname: string): { prefix: string; action: ActionType } | null {
  for (const rule of GO_PROXY_RULES) {
    if (pathname === rule.prefix || pathname.startsWith(rule.prefix + "/")) return rule;
  }
  return null;
}
