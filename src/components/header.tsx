"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import api from "@/lib/api";
import { useRole } from "@/components/role-provider";
import { type Role, ROLE_LABELS } from "@/lib/roles";

interface Shop {
  id: string;
  name: string;
}

const ROLES: Role[] = ["president", "manager", "part_time"];

export default function Header() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState("");
  const router = useRouter();
  const { role, setRoleOverride } = useRole();

  useEffect(() => {
    const fetchShops = async () => {
      try {
        const res = await api.get("/api/shop");
        if (res.data && Array.isArray(res.data)) {
          setShops(res.data);
          if (res.data.length > 0) {
            setSelectedShop(res.data[0].id);
          }
        }
      } catch {
        setShops([
          { id: "1", name: "店舗を読み込み中..." },
        ]);
      }
    };
    fetchShops();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <header className="bg-[#E6EEFF] shadow-xl h-[60px] w-full py-2 px-4 flex items-center justify-between fixed top-0 left-0 z-50 text-[#324567]">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-[#003D6B]">SPOTLIGHT</span>
          <span className="text-[#324567]"> NAVIGATOR</span>
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <select
          aria-label="店舗を選択"
          className="bg-white border border-[#003D6B]/20 rounded-md px-3 py-1.5 text-sm text-[#324567] focus:outline-none focus:ring-2 focus:ring-[#003D6B]/30 max-w-[300px]"
          value={selectedShop}
          onChange={(e) => setSelectedShop(e.target.value)}
        >
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
