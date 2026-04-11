"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { useState } from "react";
import { useRole } from "@/components/role-provider";
import { canShowInSidebar } from "@/lib/roles";

const navSections = [
  {
    title: null,
    items: [
      { href: "/", label: "ダッシュボード" },
      { href: "/diagnosis", label: "店舗診断" },
    ],
  },
  {
    title: "コンテンツ管理",
    items: [
      { href: "/reviews", label: "口コミ管理" },
      { href: "/review-analysis", label: "口コミ分析(AI)" },
      { href: "https://report.new-spotlight-navigator.com", label: "レポートページ ↗" },
      { href: "/posts", label: "投稿管理・分析" },
      { href: "/aio", label: "AIO対策" },
    ],
  },
  {
    title: "店舗情報管理",
    children: [
      { href: "/shop-management", label: "店舗一覧" },
      { href: "/ranking", label: "店舗検索ランキング" },
      { href: "/reports", label: "店舗パフォーマンス" },
      { href: "/basic-info", label: "基礎情報管理" },
      { href: "/setup", label: "初期整備" },
      { href: "/citation", label: "NAP整合性" },
    ],
  },
  {
    title: "多媒体連携",
    children: [
      { href: "/media", label: "写真管理" },
    ],
  },
  {
    title: null,
    items: [
      { href: "/chatbot", label: "AI社長" },
    ],
  },
  {
    title: "システム管理",
    children: [
      { href: "/user-management", label: "ユーザー・権限管理" },
      { href: "/customer-master", label: "顧客マスタ" },
    ],
  },
];

function AccordionSection({
  title,
  items,
  pathname,
}: {
  title: string;
  items: { href: string; label: string; badge?: number }[];
  pathname: string;
}) {
  const hasActive = items.some(
    (c) => c.href === "/" ? pathname === "/" : pathname.startsWith(c.href)
  );
  const [open, setOpen] = useState(hasActive);

  return (
    <div className="w-full">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${title}メニューを${open ? "閉じる" : "開く"}`}
        className="flex items-center w-full px-4 py-3 text-sm text-white hover:bg-white/10 transition"
      >
        <div className="rounded-full h-3.5 w-3.5 bg-white/80 mr-3 flex-shrink-0" />
        <span className="flex-1 text-left">{title}</span>
        <svg
          className={cn("w-4 h-4 transition-transform text-white/60", open && "rotate-180")}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div>
          {items.map((child) => {
            const isActive =
              child.href === "/"
                ? pathname === "/" || pathname === ""
                : pathname.startsWith(child.href);
            return (
              <Link key={child.href} href={child.href}>
                <div
                  className={cn(
                    "px-10 py-2.5 text-sm transition-all",
                    isActive
                      ? "bg-white text-[#003D6B] font-bold"
                      : "text-white/90 hover:bg-white/10"
                  )}
                >
                  {child.label}
                  {child.badge && (
                    <span className="ml-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                      {child.badge}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const { role, roleLabel } = useRole();
  const [mobileOpen, setMobileOpen] = useState(false);

  // ロールに応じてセクションをフィルタリング
  const filteredSections = navSections
    .map((section) => {
      if (section.children) {
        const filtered = section.children.filter((item) => canShowInSidebar(role, item.href));
        if (filtered.length === 0) return null;
        return { ...section, children: filtered };
      }
      if (section.items) {
        const filtered = section.items.filter((item) => canShowInSidebar(role, item.href));
        if (filtered.length === 0) return null;
        return { ...section, items: filtered };
      }
      return section;
    })
    .filter(Boolean);

  return (
    <>
      {/* モバイルハンバーガーボタン */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="lg:hidden fixed top-[14px] left-3 z-[60] bg-[#003D6B] text-white p-2 rounded-lg"
        aria-label="メニューを開く"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {mobileOpen
            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />}
        </svg>
      </button>

      {/* オーバーレイ（モバイル） */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/40 z-40" onClick={() => setMobileOpen(false)} />
      )}

    <aside className={`fixed left-0 top-[60px] h-[calc(100%-60px)] w-[250px] lg:w-[15%] lg:min-w-[200px] bg-[#003D6B] text-white flex flex-col z-40 transition-transform duration-300 ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
      {/* ロール表示 */}
      <div className="px-4 pt-4 pb-2">
        <div className="bg-white/20 rounded-lg px-3 py-2.5 border border-white/10">
          <p className="text-[10px] text-white/70">ログイン中のロール</p>
          <p className="text-sm font-bold text-white drop-shadow-sm">{roleLabel}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4" aria-label="メインナビゲーション">
        {filteredSections.map((section, idx) => {
          if (!section) return null;

          // Accordion (collapsible) sections
          if (section.children) {
            return (
              <AccordionSection
                key={section.title}
                title={section.title!}
                items={section.children}
                pathname={pathname}
              />
            );
          }

          // Flat items
          return (
            <div key={idx}>
              {section.items!.map((item) => {
                const isActive =
                  item.href === "/"
                    ? pathname === "/" || pathname === ""
                    : pathname.startsWith(item.href);
                return (
                  <Link key={item.href} href={item.href}>
                    <div
                      className={cn(
                        "flex items-center px-4 py-3 text-sm transition-all",
                        isActive
                          ? "bg-white text-[#003D6B] font-bold"
                          : "text-white hover:bg-white/10"
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-full h-3.5 w-3.5 mr-3 flex-shrink-0",
                          isActive ? "bg-[#003D6B]" : "bg-white/80"
                        )}
                      />
                      <span>{item.label}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom links */}
      <div className="p-4 border-t border-white/20 text-xs space-y-2">
        <p className="text-white/60 hover:text-white cursor-pointer">プライバシー・ポリシー</p>
        <p className="text-white/60 hover:text-white cursor-pointer">利用規約</p>
      </div>
    </aside>
    </>
  );
}
