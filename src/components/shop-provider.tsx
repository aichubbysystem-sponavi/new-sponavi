"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Shop } from "@/lib/api-types";

interface ShopContextType {
  shops: Shop[];
  selectedShopId: string;
  selectedShop: Shop | null;
  setSelectedShopId: (id: string) => void;
  loading: boolean;
  apiConnected: boolean;
  refreshShops: () => Promise<void>;
  shopFilterMode: "all" | "single";
  setShopFilterMode: (mode: "all" | "single") => void;
  unrepliedCount: number;
  refreshUnreplied: () => Promise<void>;
  favoriteShopIds: Set<string>;
  setFavoriteShopIds: (ids: Set<string>) => void;
}

const ShopContext = createContext<ShopContextType>({
  shops: [],
  selectedShopId: "",
  selectedShop: null,
  setSelectedShopId: () => {},
  loading: true,
  apiConnected: false,
  refreshShops: async () => {},
  shopFilterMode: "single",
  setShopFilterMode: () => {},
  unrepliedCount: 0,
  refreshUnreplied: async () => {},
  favoriteShopIds: new Set(),
  setFavoriteShopIds: () => {},
});

export function useShop() {
  return useContext(ShopContext);
}

export default function ShopProvider({ children }: { children: React.ReactNode }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopId] = useState("");
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [shopFilterMode, setShopFilterMode] = useState<"all" | "single">("all");
  const [unrepliedCount, setUnrepliedCount] = useState(0);
  const [favoriteShopIds, setFavoriteShopIdsRaw] = useState<Set<string>>(new Set());
  const setFavoriteShopIds = useCallback((ids: Set<string>) => {
    setFavoriteShopIdsRaw(ids);
  }, []);

  // 「いつもの店舗」をgrid_ranking_presetsから取得
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/api/report/grid-ranking-presets");
        const presets = res.data?.presets || [];
        if (presets.length > 0) {
          setFavoriteShopIdsRaw(new Set(presets.map((p: any) => p.shop_id)));
        }
      } catch {}
    })();
  }, []);

  const fetchUnreplied = useCallback(async () => {
    try {
      const { count } = await supabase
        .from("reviews")
        .select("id", { count: "exact", head: true })
        .is("reply_comment", null);
      setUnrepliedCount(count || 0);
    } catch {}
  }, []);

  const fetchShops = useCallback(async () => {
    try {
      const res = await api.get("/api/shop");
      const data: Shop[] = Array.isArray(res.data) ? res.data : [];
      setShops(data);
      setApiConnected(true);
      if (data.length > 0 && !selectedShopId) {
        setSelectedShopId(data[0].id);
      }
    } catch {
      setApiConnected(false);
    }
    setLoading(false);
  }, [selectedShopId]);

  useEffect(() => { fetchShops(); }, [fetchShops]);
  useEffect(() => { fetchUnreplied(); }, [fetchUnreplied]);

  const selectedShop = shops.find((s) => s.id === selectedShopId) || null;

  return (
    <ShopContext.Provider value={{
      shops,
      selectedShopId,
      selectedShop,
      setSelectedShopId,
      loading,
      apiConnected,
      refreshShops: fetchShops,
      shopFilterMode,
      setShopFilterMode,
      unrepliedCount,
      refreshUnreplied: fetchUnreplied,
      favoriteShopIds,
      setFavoriteShopIds,
    }}>
      {children}
    </ShopContext.Provider>
  );
}
