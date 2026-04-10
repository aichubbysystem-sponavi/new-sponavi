"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api from "@/lib/api";
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
});

export function useShop() {
  return useContext(ShopContext);
}

export default function ShopProvider({ children }: { children: React.ReactNode }) {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShopId, setSelectedShopId] = useState("");
  const [loading, setLoading] = useState(true);
  const [apiConnected, setApiConnected] = useState(false);
  const [shopFilterMode, setShopFilterMode] = useState<"all" | "single">("single");

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
    }}>
      {children}
    </ShopContext.Provider>
  );
}
