"use client";

import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useRole } from "@/components/role-provider";
import { useShop } from "@/components/shop-provider";
import { type Role, ROLE_LABELS } from "@/lib/roles";

const ROLES: Role[] = ["president", "manager", "part_time"];

export default function Header() {
  const router = useRouter();
  const { role, setRoleOverride } = useRole();
  const { shops, selectedShopId, setSelectedShopId } = useShop();

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
        <select
          aria-label="店舗を選択"
          className="bg-white border border-[#003D6B]/20 rounded-md px-2 lg:px-3 py-1.5 text-xs lg:text-sm text-[#324567] focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 max-w-[120px] lg:max-w-[300px]"
          value={selectedShopId}
          onChange={(e) => setSelectedShopId(e.target.value)}
        >
          {shops.length === 0 && <option value="">店舗未登録</option>}
          {shops.map((shop) => (
            <option key={shop.id} value={shop.id}>{shop.name}</option>
          ))}
        </select>

        {/* ロール切替（デモ用） */}
        <select
          aria-label="ロールを切替"
          className="bg-white border border-amber-300 rounded-md px-2 py-1.5 text-xs text-[#324567] focus:outline-none focus:ring-2 focus:ring-amber-300"
          value={role}
          onChange={(e) => {
            setRoleOverride(e.target.value as Role);
            router.push("/");
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>{ROLE_LABELS[r]}</option>
          ))}
        </select>

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
