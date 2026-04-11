"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
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
  const [descResult, setDescResult] = useState("");
  const [descLoading, setDescLoading] = useState(false);
  const [descKeywords, setDescKeywords] = useState("");
  const [catResult, setCatResult] = useState("");
  const [catLoading, setCatLoading] = useState(false);
  const [showHearing, setShowHearing] = useState(false);
  const [hearingSaving, setHearingSaving] = useState(false);
  const [hearingMsg, setHearingMsg] = useState("");
  const [hearing, setHearing] = useState({
    tone: "", atmosphere: "", target: "", strength: "", menu_highlight: "",
    area: "", business_hours_note: "", seasonal: "", sns: "", other: "",
  });

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

  // ヒアリングシート取得
  useEffect(() => {
    if (!selectedShopId) return;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const res = await fetch(`/api/report/hearing?shopId=${selectedShopId}`, {
          headers: { "Authorization": `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data?.data) setHearing({ ...hearing, ...data.data });
        }
      } catch {}
    })();
  }, [selectedShopId]);

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

          {/* AI初期整備ツール */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
            {/* 説明文生成 */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500 mb-3">AI説明文生成</h3>
              <p className="text-[10px] text-slate-400 mb-3">MEO・AIO対策に最適なGBP説明文（750〜1000文字）を自動生成</p>
              <input type="text" value={descKeywords} onChange={(e) => setDescKeywords(e.target.value)}
                placeholder="対策キーワード（例: テイクアウト, ランチ）"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-2" />
              <button onClick={async () => {
                setDescLoading(true); setDescResult("");
                try {
                  const token = (await supabase.auth.getSession()).data.session?.access_token;
                  const res = await fetch("/api/report/generate-description", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                    body: JSON.stringify({
                      mode: "description",
                      shopName: selectedShop?.name || "",
                      category: gbpData?.categories?.primaryCategory?.displayName || "",
                      keywords: descKeywords,
                      currentDescription: gbpData?.profile?.description || "",
                      address: `${selectedShop?.state || ""}${selectedShop?.city || ""}`,
                      hearing: Object.values(hearing).some(v => v) ? hearing : undefined,
                    }),
                  });
                  const data = await res.json();
                  setDescResult(data.result || "生成に失敗しました");
                } catch { setDescResult("エラーが発生しました"); }
                setDescLoading(false);
              }} disabled={descLoading}
                className={`px-4 py-2 rounded-lg text-xs font-semibold w-full ${descLoading ? "bg-slate-200 text-slate-400" : "bg-purple-600 hover:bg-purple-700"}`}
                style={{ color: descLoading ? undefined : "#fff" }}>
                {descLoading ? "生成中..." : "説明文を3候補生成"}
              </button>
              {descResult && (
                <div className="mt-3 bg-purple-50 rounded-lg p-3 border border-purple-200 max-h-[300px] overflow-y-auto">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-purple-600 font-semibold">生成結果</p>
                    <button onClick={() => navigator.clipboard.writeText(descResult)}
                      className="text-[10px] text-purple-500 px-2 py-0.5 rounded bg-white border border-purple-200">全文コピー</button>
                  </div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">{descResult}</p>
                </div>
              )}
            </div>

            {/* カテゴリ提案 */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
              <h3 className="text-sm font-semibold text-slate-500 mb-3">AIカテゴリ提案</h3>
              <p className="text-[10px] text-slate-400 mb-3">MEO対策に最適なメイン+追加カテゴリを自動提案</p>
              {gbpData?.categories?.primaryCategory && (
                <p className="text-xs text-slate-600 mb-2">現在のメインカテゴリ: <span className="font-semibold text-[#003D6B]">{gbpData.categories.primaryCategory.displayName}</span></p>
              )}
              {gbpData?.categories?.additionalCategories?.length > 0 && (
                <p className="text-xs text-slate-500 mb-3">追加カテゴリ: {gbpData.categories.additionalCategories.map((c: any) => c.displayName).join(", ")}</p>
              )}
              <button onClick={async () => {
                setCatLoading(true); setCatResult("");
                try {
                  const token = (await supabase.auth.getSession()).data.session?.access_token;
                  const res = await fetch("/api/report/generate-description", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                    body: JSON.stringify({
                      mode: "category",
                      shopName: selectedShop?.name || "",
                      category: gbpData?.categories?.primaryCategory?.displayName || "",
                      address: `${selectedShop?.state || ""}${selectedShop?.city || ""}`,
                    }),
                  });
                  const data = await res.json();
                  setCatResult(data.result || "生成に失敗しました");
                } catch { setCatResult("エラーが発生しました"); }
                setCatLoading(false);
              }} disabled={catLoading}
                className={`px-4 py-2 rounded-lg text-xs font-semibold w-full ${catLoading ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
                style={{ color: catLoading ? undefined : "#fff" }}>
                {catLoading ? "分析中..." : "最適カテゴリを提案"}
              </button>
              {catResult && (
                <div className="mt-3 bg-blue-50 rounded-lg p-3 border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-blue-600 font-semibold">カテゴリ提案</p>
                    <button onClick={() => navigator.clipboard.writeText(catResult)}
                      className="text-[10px] text-blue-500 px-2 py-0.5 rounded bg-white border border-blue-200">コピー</button>
                  </div>
                  <p className="text-xs text-slate-700 whitespace-pre-wrap">{catResult}</p>
                </div>
              )}
            </div>
          </div>
          {/* ヒアリングシート */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 mt-6">
            <button onClick={() => setShowHearing(!showHearing)}
              className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition">
              <div>
                <h3 className="text-sm font-semibold text-slate-500">ヒアリングシート</h3>
                <p className="text-[10px] text-slate-400 mt-0.5">店舗の特徴・トンマナを記録 → 投稿文・説明文生成に自動反映</p>
              </div>
              <span className="text-xs text-slate-400">{showHearing ? "▲ 閉じる" : "▼ 開く"}</span>
            </button>
            {showHearing && (
              <div className="p-5 pt-0 border-t border-slate-100">
                {hearingMsg && <p className={`text-xs mb-3 ${hearingMsg.includes("失敗") ? "text-red-600" : "text-emerald-600"}`}>{hearingMsg}</p>}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { key: "tone", label: "トンマナ", placeholder: "例: カジュアル, 高級感, アットホーム, スタイリッシュ" },
                    { key: "atmosphere", label: "店内の雰囲気", placeholder: "例: 落ち着いた空間, 活気のある, 隠れ家的" },
                    { key: "target", label: "ターゲット層", placeholder: "例: 20-30代女性, ファミリー, ビジネスマン" },
                    { key: "strength", label: "強み・差別化ポイント", placeholder: "例: 産地直送の食材, 完全個室, 駅直結" },
                    { key: "menu_highlight", label: "看板メニュー・人気商品", placeholder: "例: 黒毛和牛ステーキ, 季節限定パフェ" },
                    { key: "area", label: "商圏・対象エリア", placeholder: "例: 渋谷駅周辺, 新宿区全域" },
                    { key: "business_hours_note", label: "営業時間の特記事項", placeholder: "例: 深夜営業あり, ランチのみ土日" },
                    { key: "seasonal", label: "季節・イベント情報", placeholder: "例: 夏はビアガーデン, 12月は忘年会プラン" },
                    { key: "sns", label: "SNS・Web情報", placeholder: "例: Instagram @xxx, HP: https://..." },
                    { key: "other", label: "その他備考", placeholder: "例: ペット同伴可, テイクアウト対応" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key}>
                      <label className="text-xs text-slate-500 block mb-1">{label}</label>
                      <input type="text" value={(hearing as any)[key] || ""}
                        onChange={(e) => setHearing({ ...hearing, [key]: e.target.value })}
                        placeholder={placeholder}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs" />
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-end mt-4">
                  <button onClick={async () => {
                    setHearingSaving(true); setHearingMsg("");
                    try {
                      const token = (await supabase.auth.getSession()).data.session?.access_token;
                      await fetch("/api/report/hearing", {
                        method: "POST",
                        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                        body: JSON.stringify({ shopId: selectedShopId, data: hearing }),
                      });
                      setHearingMsg("保存しました");
                    } catch { setHearingMsg("保存に失敗しました"); }
                    setHearingSaving(false);
                  }} disabled={hearingSaving}
                    className={`px-5 py-2 rounded-lg text-xs font-semibold ${hearingSaving ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
                    style={{ color: hearingSaving ? undefined : "#fff" }}>
                    {hearingSaving ? "保存中..." : "ヒアリングシートを保存"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
