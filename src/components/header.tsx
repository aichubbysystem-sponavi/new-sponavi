"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import api from "@/lib/api";

interface Shop {
  id: string;
  name: string;
}

export default function Header() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState("");
  const router = useRouter();

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
        // API未接続時はモックデータを表示
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

      <div className="flex items-center gap-4">
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

        <button
          aria-label="設定"
          className="text-sm text-[#324567] hover:text-[#003D6B] transition px-2 py-1 rounded hover:bg-white/50"
        >
          ⚙️ 設定
        </button>

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
