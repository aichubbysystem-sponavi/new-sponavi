"use client";

import { usePathname } from "next/navigation";
import { useRole } from "@/components/role-provider";
import { hasAccess, ROLE_LABELS } from "@/lib/roles";
import Link from "next/link";

export default function RoleGuard({ children }: { children: React.ReactNode }) {
  const { role, loading } = useRole();
  const pathname = usePathname();

  if (loading) return null;

  if (!hasAccess(role, pathname)) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              className="w-8 h-8 text-amber-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m0 0v2m0-2h2m-2 0H10m-4.93-4.364A9 9 0 1112 3a9 9 0 01-4.93 13.636z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-700 mb-2">
            アクセス権限がありません
          </h2>
          <p className="text-sm text-slate-500 mb-2">
            現在のロール: <span className="font-bold text-[#003D6B]">{ROLE_LABELS[role]}</span>
          </p>
          <p className="text-sm text-slate-400 mb-6">
            このページへのアクセスには上位の権限が必要です。
          </p>
          <Link
            href="/"
            className="inline-block bg-[#003D6B] text-white px-6 py-3 rounded-lg font-medium hover:bg-[#002a4a] transition"
          >
            ダッシュボードに戻る
          </Link>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
