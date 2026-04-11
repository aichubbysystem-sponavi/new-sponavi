"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useRole } from "@/components/role-provider";
import { useShop } from "@/components/shop-provider";
import { type Role, ROLE_LABELS } from "@/lib/roles";

const ROLES: Role[] = ["president", "manager", "part_time"];

export default function Header() {
  const router = useRouter();
  const { role, setRoleOverride } = useRole();
  const { shops, selectedShopId, setSelectedShopId, selectedShop, shopFilterMode, setShopFilterMode } = useShop();
  const [shopSearch, setShopSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredShops = shopSearch
    ? shops.filter((s) => s.name.toLowerCase().includes(shopSearch.toLowerCase()))
    : shops;

  // 外部クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <header className="bg-[#E6EEFF] shadow-xl h-[60px] w-full py-2 px-4 flex items-center justify-between fixed top-0 left-0 z-50 text-[#324567]">
      <div className="flex items-center gap-2 pl-10 lg:pl-0">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-[#003D6B]">SPOTLIGHT</span>
          <span className="text-[#324567] hidden sm:inline"> NAVIGATOR</span>
        </h1>
      </div>

      <div className="flex items-center gap-2 lg:gap-3">
        {/* 店舗検索ドロップダウン */}
        <div className="relative" ref={dropdownRef}>
          <input
            type="text"
            placeholder={shopFilterMode === "all" ? "全店舗表示中" : (selectedShop?.name || "店舗を検索...")}
            value={showDropdown ? shopSearch : ""}
            onChange={(e) => setShopSearch(e.target.value)}
            onFocus={() => { setShowDropdown(true); setShopSearch(""); }}
            className="bg-white border border-[#003D6B]/20 rounded-md px-3 py-1.5 text-xs lg:text-sm text-[#324567] focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 w-[160px] lg:w-[280px]"
          />
          {!showDropdown && (
            <div className="absolute inset-0 flex items-center px-3 pointer-events-none">
              <span className="text-xs lg:text-sm text-[#324567] truncate">
                {shopFilterMode === "all" ? `全店舗（${shops.length}）` : selectedShop?.name || ""}
              </span>
            </div>
          )}
          {showDropdown && (
            <div className="absolute top-full left-0 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-[360px] overflow-hidden z-[9999] flex flex-col">
              {/* 全店舗ボタン */}
              <button
                onClick={() => {
                  setShopFilterMode("all");
                  setShowDropdown(false);
                  setShopSearch("");
                }}
                className={`w-full text-left px-3 py-2.5 text-xs font-bold border-b border-slate-100 transition ${
                  shopFilterMode === "all" ? "bg-[#003D6B] text-white" : "bg-slate-50 text-[#003D6B] hover:bg-blue-50"
                }`}
              >
                全店舗表示（{shops.length}店舗）
              </button>
              <div className="overflow-y-auto max-h-[300px]">
                {filteredShops.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-slate-400">該当なし</div>
                ) : (
                  filteredShops.map((shop) => (
                    <button
                      key={shop.id}
                      onClick={() => {
                        setSelectedShopId(shop.id);
                        setShopFilterMode("single");
                        setShowDropdown(false);
                        setShopSearch("");
                      }}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 transition truncate ${
                        shopFilterMode === "single" && shop.id === selectedShopId ? "bg-blue-50 text-[#003D6B] font-semibold" : "text-slate-700"
                      }`}
                    >
                      {shop.name}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleLogout}
          aria-label="ログアウト"
          className="text-sm bg-[#003D6B] !text-white px-3 py-1.5 rounded-md hover:bg-[#002a4a] transition"
          style={{ color: "white" }}
        >
          ログアウト
        </button>
      </div>
    </header>
  );
}
