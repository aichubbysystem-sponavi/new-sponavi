"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import api from "@/lib/api";

interface CheckItem {
  label: string;
  status: "ok" | "warning" | "ng";
  detail: string;
}

export default function SetupPage() {
  const { apiConnected, selectedShopId, selectedShop } = useShop();
  const [checks, setChecks] = useState<CheckItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [gbpData, setGbpData] = useState<any>(null);
  const [score, setScore] = useState(0);

  const runCheck = useCallback(async () => {
    if (!selectedShopId) return;
    setLoading(true);
    const items: CheckItem[] = [];
    let gbp: any = null;

    // GBPロケーション情報取得
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/location`);
      gbp = res.data;
      setGbpData(gbp);
    } catch {
      setGbpData(null);
    }

    const shop = selectedShop as any;

    // 1. GBP接続
    items.push({
      label: "GBP接続",
      status: shop?.gbp_location_name ? "ok" : "ng",
      detail: shop?.gbp_location_name ? "接続済み" : "GBPロケーション未設定",
    });

    // 2. 店舗名
    items.push({
      label: "店舗名",
      status: gbp?.title ? "ok" : shop?.name ? "warning" : "ng",
      detail: gbp?.title || shop?.name || "未設定",
    });

    // 3. 住所
    const hasAddr = gbp?.storefrontAddress?.addressLines?.length > 0;
    items.push({
      label: "住所",
      status: hasAddr ? "ok" : shop?.address ? "warning" : "ng",
      detail: hasAddr ? (gbp.storefrontAddress.addressLines || []).join(" ") : (shop?.state || "") + (shop?.city || "") + (shop?.address || "") || "未設定",
    });

    // 4. 電話番号
    const hasPhone = gbp?.phoneNumbers?.primaryPhone;
    items.push({
      label: "電話番号",
      status: hasPhone ? "ok" : shop?.phone ? "warning" : "ng",
      detail: hasPhone || shop?.phone || "未設定",
    });

    // 5. ウェブサイト
    items.push({
      label: "ウェブサイト",
      status: gbp?.websiteUri ? "ok" : "ng",
      detail: gbp?.websiteUri || "未設定",
    });

    // 6. メインカテゴリ
    items.push({
      label: "メインカテゴリ",
      status: gbp?.categories?.primaryCategory ? "ok" : "ng",
      detail: gbp?.categories?.primaryCategory?.displayName || "未設定",
    });

    // 7. 追加カテゴリ
    const addCats = gbp?.categories?.additionalCategories || [];
    items.push({
      label: "追加カテゴリ",
      status: addCats.length >= 2 ? "ok" : addCats.length === 1 ? "warning" : "ng",
      detail: addCats.length > 0 ? addCats.map((c: any) => c.displayName).join(", ") : "未設定（推奨: 2つ以上）",
    });

    // 8. 営業時間
    const hasHours = gbp?.regularHours?.periods?.length > 0;
    items.push({
      label: "営業時間",
      status: hasHours ? "ok" : "ng",
      detail: hasHours ? `${gbp.regularHours.periods.length}件設定済み` : "未設定",
    });

    // 9. ビジネスの説明
    items.push({
      label: "ビジネスの説明",
      status: gbp?.profile?.description ? "ok" : "ng",
      detail: gbp?.profile?.description ? `${gbp.profile.description.length}文字` : "未設定（推奨: 750文字以上）",
    });

    // 10. 口コミ数
    let reviewCount = 0;
    try {
      const revRes = await api.get(`/api/shop/${selectedShopId}/review`);
      reviewCount = revRes.data?.totalReviewCount || revRes.data?.reviews?.length || 0;
    } catch {}
    items.push({
      label: "口コミ数",
      status: reviewCount >= 10 ? "ok" : reviewCount >= 1 ? "warning" : "ng",
      detail: `${reviewCount}件${reviewCount < 10 ? "（推奨: 10件以上）" : ""}`,
    });

    // 11. 投稿数
    let postCount = 0;
    try {
      const postRes = await api.get(`/api/shop/${selectedShopId}/local_post`);
      postCount = postRes.data?.localPosts?.length || 0;
    } catch {}
    items.push({
      label: "GBP投稿数",
      status: postCount >= 5 ? "ok" : postCount >= 1 ? "warning" : "ng",
      detail: `${postCount}件${postCount < 5 ? "（推奨: 5件以上）" : ""}`,
    });

    // 12. 写真数
    let photoCount = 0;
    try {
      const mediaRes = await api.get(`/api/shop/${selectedShopId}/media`);
      photoCount = mediaRes.data?.mediaItems?.length || 0;
    } catch {}
    items.push({
      label: "写真数",
      status: photoCount >= 10 ? "ok" : photoCount >= 1 ? "warning" : "ng",
      detail: `${photoCount}枚${photoCount < 10 ? "（推奨: 10枚以上）" : ""}`,
    });

    setChecks(items);
    setScore(Math.round((items.filter((c) => c.status === "ok").length / items.length) * 100));
    setLoading(false);
  }, [selectedShopId, selectedShop]);

  useEffect(() => { runCheck(); }, [runCheck]);

  const statusIcon = (s: string) => s === "ok" ? "✓" : s === "warning" ? "△" : "✕";
  const statusColor = (s: string) => s === "ok" ? "text-emerald-600" : s === "warning" ? "text-amber-600" : "text-red-600";
  const statusBg = (s: string) => s === "ok" ? "bg-emerald-50" : s === "warning" ? "bg-amber-50" : "bg-red-50";

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">初期整備チェック</h1>
        <p className="text-sm text-slate-500 mt-1">GBP情報の充実度を12項目でスコアリング</p>
      </div>

      {!apiConnected || !selectedShopId ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続してください"}</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">チェック中...</p>
        </div>
      ) : (
        <>
          {/* スコア */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">整備スコア</p>
              <div className="flex items-end gap-1">
                <span className={`text-4xl font-bold ${score >= 80 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-red-600"}`}>{score}</span>
                <span className="text-lg text-slate-400 mb-1">%</span>
              </div>
            </div>
            <div className="bg-emerald-50 rounded-xl p-5 shadow-sm border border-emerald-100">
              <p className="text-[11px] font-medium text-emerald-500 mb-1">OK</p>
              <p className="text-2xl font-bold text-emerald-600">{checks.filter((c) => c.status === "ok").length}</p>
            </div>
            <div className="bg-amber-50 rounded-xl p-5 shadow-sm border border-amber-100">
              <p className="text-[11px] font-medium text-amber-500 mb-1">要改善</p>
              <p className="text-2xl font-bold text-amber-600">{checks.filter((c) => c.status === "warning").length}</p>
            </div>
            <div className="bg-red-50 rounded-xl p-5 shadow-sm border border-red-100">
              <p className="text-[11px] font-medium text-red-500 mb-1">未設定</p>
              <p className="text-2xl font-bold text-red-600">{checks.filter((c) => c.status === "ng").length}</p>
            </div>
          </div>

          {/* チェックリスト */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100">
            <div className="p-4 border-b border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500">GBP整備チェックリスト（12項目）</h3>
            </div>
            <div className="divide-y divide-slate-50">
              {checks.map((item, i) => (
                <div key={i} className={`flex items-center gap-4 p-4 ${statusBg(item.status)}`}>
                  <span className={`text-xl font-bold ${statusColor(item.status)}`}>{statusIcon(item.status)}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-slate-800">{item.label}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{item.detail}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    item.status === "ok" ? "bg-emerald-100 text-emerald-700" :
                    item.status === "warning" ? "bg-amber-100 text-amber-700" :
                    "bg-red-100 text-red-700"
                  }`}>
                    {item.status === "ok" ? "OK" : item.status === "warning" ? "要改善" : "未設定"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
