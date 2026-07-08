import RoleProvider from "@/components/role-provider";

/**
 * P-MAX画面は app-shell 外（サイドバー無しの独立レイアウト）のため、
 * ボタン権限判定(useRole)用に RoleProvider をここで供給する。
 * 共有リンク（/pmax/share/[token] 等）は未認証だが、その場合ロールは
 * part_time 扱いになるだけで、顧客向け閲覧には影響しない。
 */
export default function PmaxLayout({ children }: { children: React.ReactNode }) {
  return <RoleProvider>{children}</RoleProvider>;
}
