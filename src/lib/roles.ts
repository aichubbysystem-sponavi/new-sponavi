// === 権限管理システム ===
// ロール定義・アクション権限は src/lib/permissions.ts が単一情報源。
// このファイルは「ページ単位のアクセス制御」を担当する。

import type { AppRole } from "./permissions";

export type Role = AppRole;

export const ROLE_LABELS: Record<Role, string> = {
  president: "社長",
  executive: "幹部",
  manager: "社員",
  part_time: "バイト",
};

// 各ロールがアクセスできるパス
const ROLE_PERMISSIONS: Record<Role, string[]> = {
  president: [
    "/",
    "/diagnosis",
    "/reviews",
    "/posts",
    "/aio",
    "/shop-management",
    "/search-keywords",
    "/grid-ranking",
    "/reports",
    "/report",
    "/basic-info",
    "/setup",
    "/citation",
    "/pmax",
    "/ads",
    "/media",
    "/organic",
    "/ota",
    "/lead",
    "/chatbot",
    "/admin",
    "/user-management",
    "/customer-master",
    "/ai-integration",
    "/feature",
    "/review-analysis",
    "/review-language",
    "/group-management",
    "/gbp-accounts",
    "/audit-log",
  ],
  // 幹部: 社員と同じページ集合（管理系ページは社長のみ）。ボタン操作の可否は permissions.ts の can() で制御
  executive: [
    "/",
    "/diagnosis",
    "/reviews",
    "/posts",
    "/aio",
    "/shop-management",
    "/search-keywords",
    "/grid-ranking",
    "/reports",
    "/report",
    "/basic-info",
    "/setup",
    "/citation",
    "/pmax",
    "/ads",
    "/media",
    "/organic",
    "/ota",
    "/lead",
    "/chatbot",
    "/ai-integration",
    "/feature",
    "/review-analysis",
  ],
  manager: [
    "/",
    "/diagnosis",
    "/reviews",
    "/posts",
    "/aio",
    "/shop-management",
    "/search-keywords",
    "/grid-ranking",
    "/reports",
    "/report",
    "/basic-info",
    "/setup",
    "/citation",
    "/pmax",
    "/ads",
    "/media",
    "/organic",
    "/ota",
    "/lead",
    "/chatbot",
    "/ai-integration",
    "/feature",
    "/review-analysis",
  ],
  part_time: [
    "/",
    "/diagnosis",
    "/reviews",
    "/posts",
  ],
};

/**
 * 指定ロールが指定パスにアクセスできるか判定
 */
export function hasAccess(role: Role, pathname: string): boolean {
  const permissions = ROLE_PERMISSIONS[role];
  // 完全一致 or パスの先頭一致（/feature/xxx 等のサブパス対応）
  return permissions.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(p + "/")
  );
}

/**
 * 指定ロールでサイドバーに表示するかを判定
 */
export function canShowInSidebar(role: Role, href: string): boolean {
  return hasAccess(role, href);
}

/**
 * デフォルトロール（ロールが設定されていない場合）
 */
export const DEFAULT_ROLE: Role = "part_time";
