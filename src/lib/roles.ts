// === 権限管理システム ===

export type Role = "president" | "manager" | "part_time";

export const ROLE_LABELS: Record<Role, string> = {
  president: "社長",
  manager: "マネージャー",
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
    "/ranking",
    "/reports",
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
  ],
  manager: [
    "/",
    "/diagnosis",
    "/reviews",
    "/posts",
    "/aio",
    "/shop-management",
    "/ranking",
    "/reports",
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
    "/ranking",
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
