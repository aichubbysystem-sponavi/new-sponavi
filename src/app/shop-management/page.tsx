"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function ShopManagementPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/customer-master"); }, [router]);
  return <div className="p-12 text-center text-slate-400">顧客マスタに移動中...</div>;
}
