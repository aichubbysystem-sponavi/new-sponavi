"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { logAudit } from "@/lib/audit-log";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

interface ReviewRow {
  id: string;
  shop_id: string;
  shop_name: string;
  review_id: string;
  reviewer_name: string;
  star_rating: string;
  comment: string | null;
  reply_comment: string | null;
  create_time: string;
  synced_at: string;
}

type ReplyFilter = "all" | "unreplied" | "replied";
const PER_PAGE = 20;

export default function ReviewsPage() {
  const { selectedShopId, selectedShop, apiConnected, shops, shopFilterMode } = useShop();
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [aiReplyId, setAiReplyId] = useState<string | null>(null);
  const [aiReply, setAiReply] = useState("");
  const [aiReplies, setAiReplies] = useState<string[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [replyFilter, setReplyFilter] = useState<ReplyFilter>("all");
  const [unrepliedCount, setUnrepliedCount] = useState(0);
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  const [selectedMonth, setSelectedMonth] = useState<string>("all"); // "all" or "2026-04"
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [topWords, setTopWords] = useState<{ word: string; count: number; type: "good" | "bad" }[]>([]);
  const [monthlyStats, setMonthlyStats] = useState<{ month: string; count: number; avgRating: number; cumulative: number }[]>([]);
  const [showCharts, setShowCharts] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; content: string; star_category: string; use_count: number }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const isAllMode = shopFilterMode === "all";

  const fetchReviews = useCallback(async () => {
    if (!isAllMode && !selectedShopId) {
      setReviews([]);
      setTotalCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const from = (page - 1) * PER_PAGE;
      const to = from + PER_PAGE - 1;

      let query = supabase
        .from("reviews")
        .select("*", { count: "exact" })
        .order("create_time", { ascending: dateSort === "asc" })
        .range(from, to);

      if (!isAllMode && selectedShopId) {
        query = query.eq("shop_id", selectedShopId);
      }

      if (replyFilter === "unreplied") {
        query = query.is("reply_comment", null);
      } else if (replyFilter === "replied") {
        query = query.not("reply_comment", "is", null);
      }

      // 月別フィルタ
      if (selectedMonth !== "all") {
        const startDate = `${selectedMonth}-01T00:00:00`;
        const [y, m] = selectedMonth.split("-").map(Number);
        const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
        const endDate = `${nextMonth}-01T00:00:00`;
        query = query.gte("create_time", startDate).lt("create_time", endDate);
      }

      const { data, count, error } = await query;
      if (error) {
        console.error("[reviews] fetch error:", error);
        setReviews([]);
        setTotalCount(0);
      } else {
        setReviews(data || []);
        setTotalCount(count || 0);
        if (data && data.length > 0) {
          setLastSynced(data[0].synced_at);
        }
      }
    } catch (err) {
      console.error("[reviews] unexpected error:", err);
      setReviews([]);
      setTotalCount(0);
    }
    setLoading(false);
  }, [selectedShopId, page, isAllMode, replyFilter, dateSort, selectedMonth]);

  // 未返信件数を取得
  const fetchUnrepliedCount = useCallback(async () => {
    let query = supabase
      .from("reviews")
      .select("id", { count: "exact", head: true })
      .is("reply_comment", null);

    if (!isAllMode && selectedShopId) {
      query = query.eq("shop_id", selectedShopId);
    }

    const { count } = await query;
    setUnrepliedCount(count || 0);
  }, [selectedShopId, isAllMode]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  useEffect(() => {
    fetchUnrepliedCount();
  }, [fetchUnrepliedCount]);

  // 月別口コミ統計取得 + 利用可能月一覧
  useEffect(() => {
    const fetchMonthlyStats = async () => {
      const shopFilter = !isAllMode && selectedShopId ? selectedShopId : null;
      let query = supabase.from("reviews").select("create_time, star_rating");
      if (shopFilter) query = query.eq("shop_id", shopFilter);
      const { data } = await query.order("create_time", { ascending: true }).limit(5000);
      if (!data || data.length === 0) { setMonthlyStats([]); setAvailableMonths([]); return; }

      const ratingMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, ONE_STAR: 1, TWO_STARS: 2, THREE_STARS: 3, FOUR_STARS: 4, FIVE_STARS: 5 };
      const byMonth = new Map<string, { count: number; totalRating: number }>();

      data.forEach((r) => {
        if (!r.create_time) return;
        const month = r.create_time.slice(0, 7); // "2026-04"
        if (!byMonth.has(month)) byMonth.set(month, { count: 0, totalRating: 0 });
        const m = byMonth.get(month)!;
        m.count++;
        const rating = ratingMap[(r.star_rating || "").toUpperCase().replace(/_STARS?/, "")] || 0;
        m.totalRating += rating;
      });

      // 利用可能な月一覧（新しい順）
      const months = Array.from(byMonth.keys()).sort((a, b) => b.localeCompare(a));
      setAvailableMonths(months);

      let cumulative = 0;
      const stats = Array.from(byMonth.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, d]) => {
          cumulative += d.count;
          return {
            month: month.slice(2), // "26-04"
            count: d.count,
            avgRating: Math.round((d.totalRating / d.count) * 100) / 100,
            cumulative,
          };
        });
      setMonthlyStats(stats.slice(-12)); // 直近12ヶ月
    };
    fetchMonthlyStats();
  }, [selectedShopId, isAllMode]);

  // テンプレート取得
  const fetchTemplates = useCallback(async () => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch("/api/report/reply-templates", {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) setTemplates(await res.json());
    } catch {}
  }, []);
  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);

  const saveAsTemplate = async (content: string, starRating: number) => {
    setSavingTemplate(true);
    try {
      const category = starRating >= 4 ? "high" : starRating >= 3 ? "mid" : "low";
      const name = `${category === "high" ? "高評価" : category === "mid" ? "中評価" : "低評価"}返信_${new Date().toLocaleDateString("ja-JP")}`;
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      await fetch("/api/report/reply-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ name, content, star_category: category }),
      });
      await fetchTemplates();
      setSyncMsg("テンプレートに保存しました");
    } catch { setSyncMsg("テンプレート保存に失敗しました"); }
    setSavingTemplate(false);
  };

  const deleteTemplate = async (id: string) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      await fetch("/api/report/reply-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ action: "delete", id }),
      });
      await fetchTemplates();
    } catch {}
  };

  // 口コミキーワード抽出（月フィルタ連動）
  useEffect(() => {
    const extractKeywords = async () => {
      const shopFilter = !isAllMode && selectedShopId ? selectedShopId : null;
      let query = supabase.from("reviews").select("comment, star_rating").not("comment", "is", null);
      if (shopFilter) query = query.eq("shop_id", shopFilter);
      // 月別フィルタ
      if (selectedMonth !== "all") {
        const startDate = `${selectedMonth}-01T00:00:00`;
        const [y, m] = selectedMonth.split("-").map(Number);
        const nextMonth = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
        query = query.gte("create_time", startDate).lt("create_time", `${nextMonth}-01T00:00:00`);
      }
      const { data: allComments } = await query.limit(500);
      if (!allComments || allComments.length === 0) { setTopWords([]); return; }

      const goodWords = new Map<string, number>();
      const badWords = new Map<string, number>();

      // ひらがなのみの断片を排除するフィルタ
      const isHiraganaOnly = (w: string) => /^[\u3040-\u309F]+$/.test(w);
      const hasKanji = (w: string) => /[\u4E00-\u9FFF]/.test(w);
      const hasKatakana = (w: string) => /[\u30A0-\u30FF]/.test(w);

      // 無意味な断片パターン（末尾が助動詞・助詞的）
      const junkSuffix = /(?:します|しました|ました|ません|ですが|ですし|ですね|ですよ|ですか|ますが|ますし|ますね|ますよ|ますか|と思い|と思う|が良い|た方が|した方|方が良|思いま|いと思|になり|になっ|をして|にして|くださ|ござい|ありが|いただ|されて|させて|しまし|してい|しており|してく|してくれ|してもら|できまし|できます|ています|ていただ|ておりま|れました|きました|みました|てました|していま|していた)$/;
      const junkPrefix = /^(?:ありがとう|ございます|いただき|させていた|してもらい|と思います|した方が良|いと思いま)/;

      allComments.forEach((r) => {
        if (!r.comment) return;
        const text = r.comment.replace(/\(Original\)[\s\S]*/i, "").replace(/\(Translated by Google\)/i, "").trim();
        const stars = starToNum(r.star_rating);
        const isGood = stars >= 4;

        // カタカナ語（2文字以上）を優先抽出
        const katakanaWords: string[] = text.match(/[\u30A0-\u30FF]{2,10}/g) || [];
        // 漢字を含む語（2-6文字）
        const kanjiWords: string[] = text.match(/[\u4E00-\u9FFF][\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]{1,5}/g) || [];
        // 「また行きたい」等のフレーズは漢字+ひらがな混合で拾う
        const mixedWords: string[] = text.match(/[\u4E00-\u9FFF\u30A0-\u30FF][\u3040-\u309F\u4E00-\u9FFF\u30A0-\u30FF]{2,5}/g) || [];

        const allWords = [...katakanaWords, ...kanjiWords, ...mixedWords];
        const seen = new Set<string>();

        allWords.forEach((w: string) => {
          if (seen.has(w)) return;
          seen.add(w);
          if (w.length < 2) return;
          // ひらがなのみは全て除外
          if (isHiraganaOnly(w)) return;
          // 無意味パターン除外
          if (junkSuffix.test(w) || junkPrefix.test(w)) return;
          // 漢字1文字+ひらがなだけ（例: 「行きた」）は除外
          if (w.length <= 3 && !hasKatakana(w) && (w.match(/[\u4E00-\u9FFF]/g) || []).length <= 1) return;

          const map = isGood ? goodWords : badWords;
          map.set(w, (map.get(w) || 0) + 1);
        });
      });

      const result: { word: string; count: number; type: "good" | "bad" }[] = [];
      goodWords.forEach((count, word) => { if (count >= 2) result.push({ word, count, type: "good" }); });
      badWords.forEach((count, word) => { if (count >= 2) result.push({ word, count, type: "bad" }); });
      result.sort((a, b) => b.count - a.count);
      setTopWords(result.slice(0, 30));
    };
    extractKeywords();
  }, [selectedShopId, isAllMode, selectedMonth]);

  // フィルタ変更時にページをリセット（pageが1以外の場合のみ）
  useEffect(() => {
    setPage((prev) => prev !== 1 ? 1 : prev);
  }, [selectedShopId, replyFilter, shopFilterMode, dateSort, selectedMonth]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMsg("口コミを同期中...");
    try {
      const shopIds = selectedShopId ? [selectedShopId] : [];
      const res = await api.post("/api/report/sync-reviews", { shopIds }, { timeout: 300000 });
      setSyncMsg(`${res.data.totalSynced}件の口コミを同期しました（${res.data.shops}店舗）`);
      logAudit("口コミ同期", `${res.data.totalSynced}件同期（${res.data.shops}店舗）`);
      await fetchReviews();
      await fetchUnrepliedCount();
    } catch (e: any) {
      setSyncMsg(`同期に失敗しました: ${e?.response?.data?.error || e?.message || "不明なエラー"}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    let totalSynced = 0;
    let totalErrors = 0;
    let stoppedAt = 0;
    const shopIds = shops.map((s) => s.id);
    const batchSize = 10;

    for (let i = 0; i < shopIds.length; i += batchSize) {
      const batch = shopIds.slice(i, i + batchSize);
      setSyncMsg(`全店舗同期中... ${i}/${shopIds.length}店舗完了（${totalSynced}件取得済み）`);
      try {
        const res = await api.post("/api/report/sync-reviews", { shopIds: batch }, { timeout: 120000 });
        totalSynced += res.data.totalSynced || 0;
        totalErrors += res.data.totalErrors || 0;
        stoppedAt = i + batchSize;
        if (totalErrors >= 5) {
          setSyncMsg(`⚠ レート制限の可能性があるため中断。${stoppedAt}/${shopIds.length}店舗完了、${totalSynced}件取得済み。`);
          await fetchReviews();
          await fetchUnrepliedCount();
          setSyncing(false);
          return;
        }
      } catch (e: any) {
        stoppedAt = i;
        setSyncMsg(`⚠ ${stoppedAt}/${shopIds.length}店舗で中断（${totalSynced}件取得済み）。原因: ${e?.message || "タイムアウト"}`);
        await fetchReviews();
        setSyncing(false);
        return;
      }
    }
    setSyncMsg(`✓ ${totalSynced}件の口コミを同期しました（${shopIds.length}店舗完了、エラー${totalErrors}件）`);
    await fetchReviews();
    await fetchUnrepliedCount();
    setSyncing(false);
  };

  const handleSyncMedia = async () => {
    setSyncing(true);
    setSyncMsg("写真を同期中...");
    try {
      const res = await api.post("/api/report/sync-media", { shopIds: selectedShopId ? [selectedShopId] : [] }, { timeout: 300000 });
      setSyncMsg(`✓ ${res.data.totalSynced}枚の写真を同期しました（${res.data.shops}店舗）`);
    } catch (e: any) {
      setSyncMsg(`写真同期に失敗しました: ${e?.response?.data?.error || e?.message || "不明なエラー"}`);
    } finally {
      setSyncing(false);
    }
  };

  const starToNum = (s: string | null | undefined) => {
    if (!s) return 0;
    const map: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    const normalized = s.toUpperCase().replace(/_STARS?/, "");
    return map[normalized] || 0;
  };

  const handleAiReply = async (review: ReviewRow) => {
    if (aiReplyId === review.id) { setAiReplyId(null); setAiReply(""); setAiReplies([]); return; }
    setAiReplyId(review.id);
    setAiLoading(true);
    setAiReply("");
    setAiReplies([]);
    try {
      const res = await api.post("/api/report/reply-suggest", {
        comment: review.comment || "",
        starRating: starToNum(review.star_rating),
        shopName: selectedShop?.name || review.shop_name || "",
        reviewerName: review.reviewer_name,
        count: 5,
      }, { timeout: 30000 });
      const replies: string[] = res.data.replies || [res.data.reply || "返信を生成できませんでした"];
      setAiReplies(replies);
      setAiReply(replies[0] || "");
    } catch (e: any) {
      setAiReply(`エラー: ${e?.response?.data?.error || e?.message || "返信生成に失敗しました"}`);
      setAiReplies([]);
    } finally {
      setAiLoading(false);
    }
  };

  const totalPages = Math.ceil(totalCount / PER_PAGE);

  const monthLabel = selectedMonth !== "all" ? ` [${selectedMonth.replace("-", "年") + "月"}]` : "";
  const displayLabel = isAllMode
    ? `全店舗${monthLabel} — ${totalCount}件`
    : `${selectedShop?.name || "店舗未選択"}${monthLabel} — ${totalCount}件`;

  return (
    <div className="animate-fade-in">
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">口コミ管理</h1>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-sm text-slate-500">口コミ一覧・返信・分析</p>
          <div className="flex items-center gap-2">
            <button onClick={handleSync} disabled={syncing || !selectedShopId}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-emerald-600 hover:bg-emerald-700"}`}
              style={{ color: syncing ? undefined : "#fff" }}>
              {syncing ? "同期中..." : "この店舗を同期"}
            </button>
            <button onClick={handleSyncAll} disabled={syncing}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
              style={{ color: syncing ? undefined : "#fff" }}>
              {syncing ? "同期中..." : "全店舗同期"}
            </button>
            <button onClick={handleSyncMedia} disabled={syncing}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${syncing ? "bg-slate-200 text-slate-400" : "bg-purple-600 hover:bg-purple-700"}`}
              style={{ color: syncing ? undefined : "#fff" }}>
              {syncing ? "同期中..." : "写真同期"}
            </button>
          </div>
        </div>
      </div>

      {syncMsg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${syncMsg.includes("失敗") || syncMsg.includes("⚠") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
          {syncMsg}
        </div>
      )}

      {/* フィルタバー */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-3 mb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="font-medium">{displayLabel}</span>
            {lastSynced && <span>最終同期: {new Date(lastSynced).toLocaleString("ja-JP")}</span>}
          </div>
          <div className="flex items-center gap-2">
            {/* 月別フィルタ */}
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="px-3 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg bg-white text-slate-700 cursor-pointer"
            >
              <option value="all">全期間</option>
              {availableMonths.map((m) => (
                <option key={m} value={m}>{m.replace("-", "年") + "月"}</option>
              ))}
            </select>
            {/* 日付ソート */}
            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setDateSort("desc")}
                className={`px-3 py-1.5 text-xs font-semibold transition ${dateSort === "desc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                新しい順
              </button>
              <button onClick={() => setDateSort("asc")}
                className={`px-3 py-1.5 text-xs font-semibold transition ${dateSort === "asc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                古い順
              </button>
            </div>
            {/* 返信フィルタ */}
            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              <button onClick={() => setReplyFilter("all")}
                className={`px-3 py-1.5 text-xs font-semibold transition ${replyFilter === "all" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                すべて
              </button>
              <button onClick={() => setReplyFilter("unreplied")}
                className={`px-3 py-1.5 text-xs font-semibold transition ${replyFilter === "unreplied" ? "bg-red-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                未返信{unrepliedCount > 0 && ` (${unrepliedCount})`}
              </button>
              <button onClick={() => setReplyFilter("replied")}
                className={`px-3 py-1.5 text-xs font-semibold transition ${replyFilter === "replied" ? "bg-emerald-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}>
                返信済み
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 口コミ推移グラフ */}
      {monthlyStats.length > 1 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-4">
          <button onClick={() => setShowCharts(!showCharts)}
            className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition">
            <span className="text-sm font-semibold text-slate-500">口コミ推移グラフ（{monthlyStats.length}ヶ月）</span>
            <span className="text-xs text-slate-400">{showCharts ? "▲ 閉じる" : "▼ 開く"}</span>
          </button>
          {showCharts && (
            <div className="px-4 pb-5 border-t border-slate-100">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-4">
                {/* 評価推移（折れ線） */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 mb-3">月別平均評価推移</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={monthlyStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis domain={[1, 5]} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: any) => [`★ ${Number(v).toFixed(2)}`, "平均評価"]} />
                      <ReferenceLine y={3.5} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "3.5", position: "right", fontSize: 10, fill: "#ef4444" }} />
                      <Line type="monotone" dataKey="avgRating" stroke="#003D6B" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                  <p className="text-[9px] text-slate-400 mt-1">赤点線 = 上位表示に必要な3.5ライン</p>
                </div>

                {/* 増加量推移（棒グラフ） */}
                <div>
                  <h4 className="text-xs font-semibold text-slate-500 mb-3">月別口コミ増加数</h4>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={monthlyStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: any) => [`${v}件`, "増加数"]} />
                      <Bar dataKey="count" fill="#003D6B" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="text-[9px] text-slate-400 mt-1">累計: {monthlyStats[monthlyStats.length - 1]?.cumulative.toLocaleString()}件</p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* テンプレート管理パネル */}
      {templates.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 mb-4">
          <button onClick={() => setShowTemplates(!showTemplates)}
            className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition">
            <span className="text-sm font-semibold text-slate-500">返信テンプレート（{templates.length}件）</span>
            <span className="text-xs text-slate-400">{showTemplates ? "▲ 閉じる" : "▼ 開く"}</span>
          </button>
          {showTemplates && (
            <div className="border-t border-slate-100 divide-y divide-slate-50">
              {templates.map((t) => (
                <div key={t.id} className="px-4 py-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-700">{t.name}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${
                        t.star_category === "high" ? "bg-emerald-50 text-emerald-600" :
                        t.star_category === "mid" ? "bg-amber-50 text-amber-600" :
                        t.star_category === "low" ? "bg-red-50 text-red-600" :
                        "bg-slate-50 text-slate-500"
                      }`}>{t.star_category === "high" ? "高評価" : t.star_category === "mid" ? "中評価" : t.star_category === "low" ? "低評価" : "共通"}</span>
                      <span className="text-[9px] text-slate-400">使用{t.use_count}回</span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2">{t.content}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => navigator.clipboard.writeText(t.content)}
                      className="text-[10px] px-2 py-1 rounded bg-slate-50 text-slate-500 hover:bg-slate-100">コピー</button>
                    <button onClick={() => deleteTemplate(t.id)}
                      className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-500 hover:bg-red-100">削除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 口コミキーワード・ワードクラウド */}
      {topWords.length > 0 && (
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-500">口コミキーワード分析{selectedMonth !== "all" ? `（${selectedMonth.replace("-", "年") + "月"}）` : ""}</h3>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400"></span> ポジティブ({topWords.filter(w => w.type === "good").length})</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-red-400"></span> ネガティブ({topWords.filter(w => w.type === "bad").length})</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 py-4 min-h-[100px]">
            {topWords.map((w, i) => {
              const maxCount = topWords[0]?.count || 1;
              const size = Math.max(11, Math.min(28, 11 + (w.count / maxCount) * 17));
              const opacity = Math.max(0.5, Math.min(1, 0.5 + (w.count / maxCount) * 0.5));
              return (
                <span key={i}
                  className={`inline-block px-2 py-0.5 rounded-full font-bold cursor-default transition-transform hover:scale-110 ${
                    w.type === "good" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"
                  }`}
                  style={{ fontSize: size, opacity }}
                  title={`${w.word}: ${w.count}回（${w.type === "good" ? "ポジティブ" : "ネガティブ"}）`}>
                  {w.word}
                </span>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-[9px] text-slate-400">高評価(★4-5)口コミ由来=緑 / 低評価(★1-3)口コミ由来=赤（最大500件を分析）</p>
            <p className="text-[9px] text-slate-400">文字サイズ=出現頻度</p>
          </div>
        </div>
      )}

      {!apiConnected ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">Go APIに接続し、店舗を登録すると口コミが表示されます</p>
        </div>
      ) : (!isAllMode && !selectedShopId) ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">店舗を選択するか、ヘッダーから「全店舗表示」を選択してください</p>
        </div>
      ) : loading ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">読み込み中...</p>
        </div>
      ) : reviews.length === 0 ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm mb-2">
            {replyFilter === "unreplied" ? "未返信の口コミはありません" : replyFilter === "replied" ? "返信済みの口コミはありません" : "口コミデータがありません"}
          </p>
          {replyFilter === "all" && <p className="text-slate-300 text-xs">「この店舗を同期」ボタンでGBPから口コミを取得してください</p>}
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {reviews.map((review) => (
              <div key={review.id} className={`bg-white rounded-xl p-5 shadow-sm border ${!review.reply_comment ? "border-amber-200" : "border-slate-100"}`}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-700">{review.reviewer_name}</span>
                    <span className="text-amber-400 text-sm">
                      {"★".repeat(starToNum(review.star_rating))}
                      {"☆".repeat(5 - starToNum(review.star_rating))}
                    </span>
                    {!review.reply_comment && (
                      <span className="text-[10px] font-semibold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">未返信</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {/* 全店舗モード時に店舗名を表示 */}
                    {isAllMode && (
                      <span className="text-[10px] text-slate-400 bg-slate-50 px-2 py-0.5 rounded-full truncate max-w-[150px]">
                        {review.shop_name}
                      </span>
                    )}
                    <span className="text-xs text-slate-400">{new Date(review.create_time).toLocaleDateString("ja-JP")}</span>
                  </div>
                </div>
                {review.comment && <p className="text-sm text-slate-600 mb-3">{
                  review.comment.includes("(Original)")
                    ? (review.comment.split("(Original)").pop()?.trim() || review.comment)
                    : (review.comment.split(/\s*\(Translated by Google\)\s*/)[0] || review.comment)
                }</p>}
                {review.reply_comment && (
                  <div className="bg-blue-50 rounded-lg p-3 border border-blue-100 mb-2">
                    <p className="text-xs text-blue-500 font-semibold mb-1">返信済み</p>
                    <p className="text-sm text-blue-700">{review.reply_comment}</p>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    onClick={() => handleAiReply(review)}
                    disabled={aiLoading && aiReplyId === review.id}
                    className={`px-3 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                      aiReplyId === review.id ? "bg-purple-100 text-purple-700" : "bg-purple-50 text-purple-600 hover:bg-purple-100"
                    }`}
                  >
                    {aiLoading && aiReplyId === review.id ? "AI生成中..." : aiReplyId === review.id ? "閉じる" : "AI返信提案"}
                  </button>
                  {!review.reply_comment && templates.length > 0 && (
                    <div className="relative group">
                      <button className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all">
                        テンプレから返信
                      </button>
                      <div className="absolute left-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-50 w-[320px] max-h-[300px] overflow-y-auto hidden group-hover:block">
                        {templates.map((t) => (
                          <button key={t.id}
                            onClick={() => { setAiReplyId(review.id); setAiReply(t.content); }}
                            className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-slate-50 transition">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-slate-700">{t.name}</span>
                              <span className="text-[9px] text-slate-400">使用{t.use_count}回</span>
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{t.content}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {aiReplyId === review.id && (aiReplies.length > 0 || aiReply) && (
                  <div className="bg-purple-50 rounded-lg p-3 border border-purple-100 mt-2">
                    <p className="text-xs text-purple-500 font-semibold mb-2">AI返信候補（{aiReplies.length}件）— クリックで選択</p>
                    <div className="space-y-2">
                      {(aiReplies.length > 0 ? aiReplies : [aiReply]).map((reply, idx) => (
                        <div key={idx}
                          onClick={() => setAiReply(reply)}
                          className={`rounded-lg p-2.5 cursor-pointer transition border ${
                            aiReply === reply ? "bg-white border-purple-400 shadow-sm" : "bg-purple-50/50 border-purple-100 hover:bg-white"
                          }`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className={`text-[10px] font-bold ${aiReply === reply ? "text-purple-700" : "text-purple-400"}`}>
                              候補 {idx + 1} {aiReply === reply ? "✓" : ""}
                            </span>
                            {aiReply === reply && (
                              <div className="flex items-center gap-1.5">
                                <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(reply); }}
                                  className="text-[10px] text-purple-500 hover:text-purple-700 px-2 py-0.5 rounded bg-white border border-purple-200">コピー</button>
                                <button onClick={(e) => { e.stopPropagation(); saveAsTemplate(reply, starToNum(review.star_rating)); }}
                                  disabled={savingTemplate}
                                  className="text-[10px] text-amber-600 hover:text-amber-700 px-2 py-0.5 rounded bg-amber-50 border border-amber-200">
                                  {savingTemplate ? "保存中..." : "テンプレ保存"}</button>
                                {review.shop_id && !review.reply_comment && (
                                  <button onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                      await api.post("/api/report/reply-review", {
                                        shopId: review.shop_id, reviewId: review.review_id, comment: reply,
                                      }, { timeout: 30000 });
                                      setSyncMsg("GBPに返信を投稿しました！");
                                      logAudit("口コミ返信", `${review.shop_name} — ${review.reviewer_name}への返信「${reply.slice(0, 50)}...」`);
                                      await fetchReviews(); await fetchUnrepliedCount();
                                      setAiReplyId(null); setAiReply(""); setAiReplies([]);
                                    } catch (e: any) {
                                      setSyncMsg(`返信投稿に失敗: ${e?.response?.data?.message || e?.message || "不明なエラー"}`);
                                    }
                                  }} className="text-[10px] text-white px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-700 font-semibold">
                                    GBPに返信</button>
                                )}
                              </div>
                            )}
                          </div>
                          <p className="text-sm text-purple-800">{reply}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 disabled:opacity-30">← 前へ</button>
              <span className="text-xs text-slate-500">{page} / {totalPages}</span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-xs border border-slate-200 disabled:opacity-30">次へ →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
