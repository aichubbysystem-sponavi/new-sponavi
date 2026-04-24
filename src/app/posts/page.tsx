"use client";

import { useState, useEffect, useCallback } from "react";
import { useShop } from "@/components/shop-provider";
import { supabase } from "@/lib/supabase";
import api from "@/lib/api";
import { logAudit } from "@/lib/audit-log";

interface LocalPost {
  name?: string;
  summary?: string;
  callToAction?: { actionType?: string; url?: string };
  createTime?: string;
  topicType?: string;
  media?: { googleUrl?: string; sourceUrl?: string; mediaFormat?: string }[];
  searchUrl?: string;
  state?: string;
  // ログ由来
  _fromLog?: boolean;
  _shopName?: string;
}

const TOPIC_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  STANDARD: { bg: "bg-blue-50", text: "text-blue-600", label: "通常投稿" },
  EVENT: { bg: "bg-purple-50", text: "text-purple-600", label: "イベント" },
  OFFER: { bg: "bg-amber-50", text: "text-amber-600", label: "特典" },
  ALERT: { bg: "bg-red-50", text: "text-red-600", label: "お知らせ" },
};

type ConfirmStatus = "unconfirmed" | "confirmed" | "needs_fix";
const STATUS_STYLES: Record<ConfirmStatus, { label: string; bg: string; text: string }> = {
  unconfirmed: { label: "未確認", bg: "bg-amber-50", text: "text-amber-600" },
  confirmed: { label: "確認済み", bg: "bg-emerald-50", text: "text-emerald-600" },
  needs_fix: { label: "要修正", bg: "bg-red-50", text: "text-red-600" },
};

// GBP投稿エラー原因特定
function diagnosePostError(error: any): { cause: string; fix: string } {
  const status = error?.response?.status;
  const msg = (error?.response?.data?.error || error?.response?.data?.message || error?.message || "").toLowerCase();

  if (status === 400) {
    if (msg.includes("photo") || msg.includes("media") || msg.includes("image")) return { cause: "写真URLが無効または読み込めません", fix: "写真URLが直接アクセス可能なURL（https://で始まる画像直リンク）か確認してください。Dropboxの場合はdl=1に変更してください。" };
    if (msg.includes("summary") || msg.includes("text")) return { cause: "投稿文が無効です", fix: "投稿文が空でないか、1500文字以内か確認してください。" };
    if (msg.includes("topic") || msg.includes("type")) return { cause: "投稿タイプが無効です", fix: "投稿タイプ（通常/イベント/特典/お知らせ）を再選択してください。" };
    return { cause: "リクエストが不正です", fix: "投稿内容を確認し、必須項目（投稿文）が入力されているか確認してください。" };
  }
  if (status === 401 || status === 403) return { cause: "GBP認証の期限切れまたは権限不足", fix: "システム管理画面からGBP OAuth再認証を実行してください。" };
  if (status === 404) return { cause: "GBPロケーションが見つかりません", fix: "店舗がGBPに正しく接続されているか確認してください。店舗一覧からGBP再インポートを試してください。" };
  if (status === 429) return { cause: "Google APIのレート制限", fix: "しばらく待ってから再試行してください（通常1-2分で解除）。" };
  if (status >= 500) return { cause: "Google側のサーバーエラー", fix: "Googleのシステム障害の可能性があります。数分後に再試行してください。" };
  if (msg.includes("timeout") || msg.includes("econnaborted")) return { cause: "タイムアウト（写真のアップロードに時間がかかりすぎ）", fix: "写真サイズを小さくするか、写真なしで投稿してみてください。" };
  if (msg.includes("network") || msg.includes("econnrefused")) return { cause: "ネットワーク接続エラー", fix: "インターネット接続を確認してください。Go APIサーバーが稼働中か確認してください。" };
  return { cause: "不明なエラー", fix: "エラー詳細を確認し、管理者に連絡してください。" };
}

export default function PostsPage() {
  const { selectedShopId, selectedShop, apiConnected, shops, shopFilterMode } = useShop();
  const [localPosts, setLocalPosts] = useState<LocalPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // 3ステップフロー
  const [postStep, setPostStep] = useState<0 | 1 | 2>(0); // 0=非表示, 1=店舗選択, 2=種類選択
  const [postTargetMode, setPostTargetMode] = useState<"all" | "selected" | "current">("current");
  const [postTargetShopIds, setPostTargetShopIds] = useState<string[]>([]);
  const [postSelectedType, setPostSelectedType] = useState("");
  const [newPost, setNewPost] = useState({ summary: "", topicType: "STANDARD", actionType: "", actionUrl: "", photoUrl: "", scheduledAt: "", mediaType: "PHOTO" as "PHOTO" | "VIDEO" });
  const [scheduledPosts, setScheduledPosts] = useState<any[]>([]);
  const [autoPostSheet, setAutoPostSheet] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("auto-post-sheet") || "1bF-gXP05a3yoi1ZRnBTH6bnKCZRfStOBEucMKYY2eNA";
    return "1bF-gXP05a3yoi1ZRnBTH6bnKCZRfStOBEucMKYY2eNA";
  });
  const [autoPostDate, setAutoPostDate] = useState(new Date().toISOString().slice(0, 10));
  const [autoPosting, setAutoPosting] = useState(false);
  const [autoPostResult, setAutoPostResult] = useState<any>(null);
  const [showAutoPost, setShowAutoPost] = useState(false);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState("");
  const [dateSort, setDateSort] = useState<"desc" | "asc">("desc");
  const [viewMode, setViewMode] = useState<"list" | "calendar" | "shops" | "plan">("list");
  const [confirmMap, setConfirmMap] = useState<Record<string, ConfirmStatus>>({});
  const [shopPostCounts, setShopPostCounts] = useState<{ name: string; count: number; lastPost: string }[]>([]);
  const [planMonth, setPlanMonth] = useState(new Date().toISOString().slice(0, 7)); // "2026-04"
  const [planItems, setPlanItems] = useState<{ id?: string; date: string; post_type: string; note: string }[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [planEditDay, setPlanEditDay] = useState<number | null>(null);
  const [planEditType, setPlanEditType] = useState("STANDARD");
  const [planEditNote, setPlanEditNote] = useState("");
  const [aiPosts, setAiPosts] = useState<string[]>([]);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiKeywords, setAiKeywords] = useState("");
  const [proofResult, setProofResult] = useState<string | null>(null);
  const [proofing, setProofing] = useState(false);
  const [showBulkGen, setShowBulkGen] = useState(false);
  const [bulkGenStart, setBulkGenStart] = useState(new Date().toISOString().slice(0, 10));
  const [bulkGenCount, setBulkGenCount] = useState(4);
  const [bulkGenning, setBulkGenning] = useState(false);
  const [bulkGenResult, setBulkGenResult] = useState<any>(null);
  const [bulkPostMode, setBulkPostMode] = useState(false);
  const [bulkPostShopIds, setBulkPostShopIds] = useState<string[]>([]);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editingSummary, setEditingSummary] = useState("");
  const [retrying, setRetrying] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [fixedMessages, setFixedMessages] = useState<{ id: string; title: string; message: string }[]>([]);
  const [showInsertMenu, setShowInsertMenu] = useState(false);

  const isAllMode = shopFilterMode === "all";

  // 差し込み文字列取得
  useEffect(() => {
    if (!selectedShopId) { setFixedMessages([]); return; }
    (async () => {
      try {
        const res = await api.get(`/api/shop/${selectedShopId}`);
        const msgs = res.data?.fixed_messages;
        if (Array.isArray(msgs) && msgs.length > 0) {
          setFixedMessages(msgs.map((m: any) => ({ id: m.id, title: m.title || "", message: m.message || "" })));
        } else {
          setFixedMessages([]);
        }
      } catch { setFixedMessages([]); }
    })();
  }, [selectedShopId]);

  // 投稿計画取得
  const fetchPlan = useCallback(async () => {
    if (!selectedShopId || isAllMode) return;
    setPlanLoading(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch(`/api/report/post-schedule?shopId=${selectedShopId}&month=${planMonth}`, {
        headers: { "Authorization": `Bearer ${token}` },
      });
      if (res.ok) setPlanItems(await res.json());
    } catch {}
    setPlanLoading(false);
  }, [selectedShopId, planMonth, isAllMode]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  const savePlanItem = async (day: number, postType: string, note: string) => {
    const date = `${planMonth}-${String(day).padStart(2, "0")}`;
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      await fetch("/api/report/post-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ shopId: selectedShopId, date, postType, note }),
      });
      await fetchPlan();
      setPlanEditDay(null);
    } catch (e: any) {
      setMsg(`計画保存失敗: ${e?.message}`);
    }
  };

  const deletePlanItem = async (id: string) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      await fetch("/api/report/post-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
        body: JSON.stringify({ action: "delete", id }),
      });
      await fetchPlan();
    } catch {}
  };

  const fetchData = useCallback(async () => {
    if (!isAllMode && !selectedShopId) return;
    setLoading(true);
    try {
      if (isAllMode) {
        // 全店舗モード: post_logsから取得
        const { data: logs } = await supabase.from("post_logs")
          .select("*").order("created_at", { ascending: false }).limit(100);
        setLocalPosts((logs || []).map((log) => ({
          summary: log.summary, topicType: log.topic_type, createTime: log.created_at,
          callToAction: log.action_type ? { actionType: log.action_type, url: log.action_url } : undefined,
          media: log.media_url ? [{ sourceUrl: log.media_url, mediaFormat: "PHOTO" }] : undefined,
          searchUrl: log.search_url || undefined,
          name: log.gbp_post_name || undefined,
          _fromLog: true, _shopName: log.shop_name,
        })));
      } else {
        // 単一店舗: GBP API + post_logs
        const gbpRes = await api.get(`/api/shop/${selectedShopId}/local_post`).catch(() => ({ data: { localPosts: [] } }));
        const gbpPosts: LocalPost[] = gbpRes.data?.localPosts || [];

        const { data: logs } = await supabase.from("post_logs")
          .select("summary, topic_type, media_url, action_type, action_url, created_at, search_url, gbp_post_name")
          .eq("shop_id", selectedShopId).order("created_at", { ascending: false });

        const logPosts: LocalPost[] = (logs || []).map((log) => ({
          summary: log.summary, topicType: log.topic_type, createTime: log.created_at,
          callToAction: log.action_type ? { actionType: log.action_type, url: log.action_url } : undefined,
          media: log.media_url ? [{ sourceUrl: log.media_url, mediaFormat: "PHOTO" }] : undefined,
          searchUrl: log.search_url || undefined,
          name: log.gbp_post_name || undefined,
          _fromLog: true,
        }));

        const gbpSummaries = new Set(gbpPosts.map((p) => p.summary?.slice(0, 30)));
        const unique = logPosts.filter((p) => !gbpSummaries.has(p.summary?.slice(0, 30)));
        setLocalPosts([...gbpPosts, ...unique]);
      }

      // 確認ステータスをlocalStorageから読み込み
      const saved = localStorage.getItem("post-confirm-status");
      if (saved) setConfirmMap(JSON.parse(saved));
    } catch { setLocalPosts([]); }
    finally { setLoading(false); }
  }, [selectedShopId, isAllMode]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 予約投稿を取得
  useEffect(() => {
    if (!selectedShopId && !isAllMode) return;
    const params = selectedShopId && !isAllMode ? `?shopId=${selectedShopId}` : "";
    api.get(`/api/report/scheduled-posts${params}`)
      .then((res) => setScheduledPosts(Array.isArray(res.data) ? res.data : []))
      .catch(() => setScheduledPosts([]));
  }, [selectedShopId, isAllMode]);

  // 全店舗の投稿状況
  useEffect(() => {
    if (!apiConnected) return;
    supabase.from("post_logs")
      .select("shop_name, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        const map = new Map<string, { count: number; lastPost: string }>();
        (data || []).forEach((log) => {
          if (!map.has(log.shop_name)) map.set(log.shop_name, { count: 0, lastPost: log.created_at });
          map.get(log.shop_name)!.count++;
        });
        // 全店舗（ログがない店舗も含む）
        const allShops = shops.map((s) => ({
          name: s.name,
          count: map.get(s.name)?.count || 0,
          lastPost: map.get(s.name)?.lastPost || "",
        }));
        setShopPostCounts(allShops);
      });
  }, [apiConnected, shops]);

  const handleCreate = async () => {
    if (!selectedShopId || !newPost.summary.trim()) { setMsg("本文を入力してください"); return; }

    // 重複チェック（文章：過去投稿と30文字以上一致 / 写真：同一URL）
    const trimmed = newPost.summary.trim();
    const warnings: string[] = [];
    const textDup = localPosts.find((p) => {
      if (!p.summary) return false;
      const a = p.summary.replace(/\s+/g, "");
      const b = trimmed.replace(/\s+/g, "");
      if (a.length < 20 || b.length < 20) return a === b;
      return a.includes(b.slice(0, 30)) || b.includes(a.slice(0, 30));
    });
    if (textDup) warnings.push(`類似の文章が既に投稿済み:\n「${textDup.summary?.slice(0, 50)}...」`);
    if (newPost.photoUrl.trim()) {
      const photoNorm = newPost.photoUrl.trim().replace(/[?#].*$/, "");
      const photoDup = localPosts.find((p) =>
        p.media?.some((m) => (m.sourceUrl || m.googleUrl || "").replace(/[?#].*$/, "") === photoNorm)
      );
      if (photoDup) warnings.push(`同じ写真が既に使用されています:\n「${photoDup.summary?.slice(0, 40) || "投稿"}」`);
    }
    if (warnings.length > 0) {
      const proceed = confirm(`⚠ 重複の可能性があります:\n\n${warnings.join("\n\n")}\n\nそれでも投稿しますか？`);
      if (!proceed) return;
    }

    setCreating(true); setMsg("");
    try {
      if (newPost.scheduledAt) {
        await api.post("/api/report/scheduled-posts", {
          shopId: selectedShopId, summary: newPost.summary, topicType: newPost.topicType,
          photoUrl: newPost.photoUrl.trim() || null, actionType: newPost.actionType || null,
          actionUrl: newPost.actionUrl || null, scheduledAt: new Date(newPost.scheduledAt).toISOString(),
        }, { timeout: 15000 });
        setMsg(`投稿を${new Date(newPost.scheduledAt).toLocaleString("ja-JP")}に予約しました！`);
        logAudit("GBP投稿予約", `${selectedShop?.name} — ${newPost.summary.slice(0, 50)} → ${new Date(newPost.scheduledAt).toLocaleString("ja-JP")}`);
        const sRes = await api.get(`/api/report/scheduled-posts?shopId=${selectedShopId}`);
        setScheduledPosts(Array.isArray(sRes.data) ? sRes.data : []);
      } else {
        const postData: any = { shopId: selectedShopId, summary: newPost.summary, topicType: newPost.topicType };
        if (newPost.actionType && newPost.actionUrl) postData.callToAction = { actionType: newPost.actionType, url: newPost.actionUrl };
        if (newPost.photoUrl.trim()) {
          postData.photoUrl = newPost.photoUrl.trim();
          postData.mediaType = newPost.mediaType || "PHOTO";
        }
        await api.post("/api/report/create-post", postData, { timeout: 30000 });
        setMsg("投稿を作成しました！");
        logAudit("GBP投稿作成", `${selectedShop?.name} — ${newPost.summary.slice(0, 50)}${newPost.photoUrl ? "（写真付き）" : ""}`);
      }
      setShowCreate(false);
      setNewPost({ summary: "", topicType: "STANDARD", actionType: "", actionUrl: "", photoUrl: "", scheduledAt: "", mediaType: "PHOTO" });
      await fetchData();
    } catch (e: any) {
      const diag = diagnosePostError(e);
      setMsg(`投稿に失敗しました\n原因: ${diag.cause}\n対処法: ${diag.fix}\n\n詳細: ${e?.response?.data?.error || e?.message || "不明"}`);
    } finally { setCreating(false); }
  };

  const handleDelete = async (postName: string) => {
    if (!confirm("この投稿をGBPから削除しますか？")) return;
    try {
      await api.post("/api/report/delete-post", { postName }, { timeout: 15000 });
      setMsg("投稿を削除しました");
      logAudit("GBP投稿削除", `投稿を削除`);
      await fetchData();
    } catch (e: any) {
      setMsg(`削除失敗: ${e?.response?.data?.error || e?.message}`);
    }
  };

  const setConfirm = (key: string, status: ConfirmStatus) => {
    const next = { ...confirmMap, [key]: status };
    setConfirmMap(next);
    localStorage.setItem("post-confirm-status", JSON.stringify(next));
  };

  const handleRetry = async (postId: string) => {
    setRetrying(postId);
    try {
      await api.patch("/api/report/scheduled-posts", {
        id: postId, status: "pending", scheduledAt: new Date().toISOString(),
      });
      setScheduledPosts(scheduledPosts.map(p => p.id === postId ? { ...p, status: "pending", scheduled_at: new Date().toISOString(), error_detail: null } : p));
      setMsg("再実行を予約しました");
    } catch (e: any) { setMsg(`再実行失敗: ${e?.message}`); }
    setRetrying(null);
  };

  const handleSaveEdit = async (postId: string) => {
    if (!editingSummary.trim()) return;
    setSavingEdit(true);
    try {
      await api.patch("/api/report/scheduled-posts", {
        id: postId, summary: editingSummary.trim(),
      });
      setScheduledPosts(scheduledPosts.map(p => p.id === postId ? { ...p, summary: editingSummary.trim() } : p));
      setEditingPostId(null); setEditingSummary("");
      setMsg("投稿内容を更新しました");
    } catch (e: any) { setMsg(`更新失敗: ${e?.message}`); }
    setSavingEdit(false);
  };

  const postKey = (p: LocalPost, i: number) => p.name || `${p.summary?.slice(0, 20)}_${i}`;

  // 統計
  const last30Days = localPosts.filter((p) => p.createTime && Date.now() - new Date(p.createTime).getTime() < 30 * 24 * 60 * 60 * 1000).length;
  const frequencyLabel = last30Days >= 8 ? "優秀" : last30Days >= 4 ? "良好" : last30Days >= 1 ? "改善余地あり" : "要改善";
  const frequencyColor = last30Days >= 8 ? "text-emerald-600" : last30Days >= 4 ? "text-blue-600" : last30Days >= 1 ? "text-amber-600" : "text-red-600";
  const typeStats = localPosts.reduce((a, p) => { const t = p.topicType || "STANDARD"; a[t] = (a[t] || 0) + 1; return a; }, {} as Record<string, number>);
  const unconfirmed = localPosts.filter((_, i) => !confirmMap[postKey(localPosts[i], i)] || confirmMap[postKey(localPosts[i], i)] === "unconfirmed").length;

  // カレンダー
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const postsByDay = localPosts.reduce((a, p) => {
    if (!p.createTime) return a;
    const d = new Date(p.createTime);
    if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
      const day = d.getDate();
      if (!a[day]) a[day] = [];
      a[day].push(p);
    }
    return a;
  }, {} as Record<number, LocalPost[]>);

  const sorted = [...localPosts].sort((a, b) => {
    const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
    const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
    return dateSort === "desc" ? tb - ta : ta - tb;
  });

  return (
    <div className="animate-fade-in">
      <div className="mb-4 mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">投稿管理・分析</h1>
          <p className="text-sm text-slate-500 mt-1">GBP投稿の作成・確認・分析・カレンダー</p>
        </div>
        {postStep === 0 && (
          <button onClick={() => setPostStep(1)}
            className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-[#003D6B] hover:bg-[#002a4a]"
            style={{ color: "#fff" }}>
            + 新規投稿
          </button>
        )}
      </div>

      {msg && (
        <div className={`p-3 rounded-lg mb-4 text-sm ${msg.includes("失敗") ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>{msg}</div>
      )}

      {!apiConnected || (!isAllMode && !selectedShopId) ? (
        <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
          <p className="text-slate-400 text-sm">{apiConnected ? "店舗を選択してください" : "Go APIに接続してください"}</p>
        </div>
      ) : (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">総投稿数</p>
              <p className="text-2xl font-bold text-[#003D6B]">{localPosts.length}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">直近30日</p>
              <p className="text-2xl font-bold text-emerald-600">{last30Days}<span className="text-xs font-normal text-slate-400 ml-1">件</span></p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">投稿頻度</p>
              <p className={`text-lg font-bold ${frequencyColor}`}>{frequencyLabel}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">未確認</p>
              <p className={`text-2xl font-bold ${unconfirmed > 0 ? "text-amber-600" : "text-emerald-600"}`}>{unconfirmed}</p>
            </div>
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
              <p className="text-[11px] font-medium text-slate-400 mb-1">タイプ別</p>
              <div className="flex flex-wrap gap-1 mt-1">
                {Object.entries(typeStats).map(([t, c]) => {
                  const s = TOPIC_STYLES[t] || TOPIC_STYLES.STANDARD;
                  return <span key={t} className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.bg} ${s.text}`}>{s.label}: {c}</span>;
                })}
              </div>
            </div>
          </div>

          {/* 3ステップ投稿フロー（KPI直後に表示） */}
          {postStep >= 1 && !showCreate && (
            <div className="mb-5">
              {/* Step 1: 投稿先店舗の選択 */}
              {postStep === 1 && (
                <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-200">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-sm font-semibold text-[#003D6B]">Step 1: 投稿先を選択</p>
                    <button onClick={() => { setPostStep(0); }} className="text-xs text-slate-400 hover:text-slate-600">キャンセル</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <button onClick={() => { setPostTargetMode("current"); setPostTargetShopIds(selectedShopId ? [selectedShopId] : []); setPostStep(2); }}
                      disabled={!selectedShopId}
                      className="p-4 rounded-xl border-2 border-slate-200 hover:bg-slate-50 text-left transition-all hover:shadow-md disabled:opacity-40">
                      <p className="text-sm font-semibold text-slate-800">選択中の店舗</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{selectedShop?.name || "未選択"}</p>
                    </button>
                    <button onClick={() => { setPostTargetMode("all"); setPostTargetShopIds(shops.map(s => s.id)); setPostStep(2); }}
                      className="p-4 rounded-xl border-2 border-emerald-200 hover:bg-emerald-50 text-left transition-all hover:shadow-md">
                      <p className="text-sm font-semibold text-slate-800">全店舗（{shops.length}店舗）</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">全店舗にまとめて投稿</p>
                    </button>
                    <button onClick={() => { setPostTargetMode("selected"); }}
                      className="p-4 rounded-xl border-2 border-purple-200 hover:bg-purple-50 text-left transition-all hover:shadow-md">
                      <p className="text-sm font-semibold text-slate-800">店舗を選んで投稿</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">チェックボックスで複数選択</p>
                    </button>
                  </div>
                  {postTargetMode === "selected" && (
                    <div className="mt-4 border-t border-slate-200 pt-3 max-h-[200px] overflow-y-auto">
                      {shops.map(s => (
                        <label key={s.id} className="flex items-center gap-2 py-1 px-2 hover:bg-slate-50 rounded cursor-pointer">
                          <input type="checkbox" checked={postTargetShopIds.includes(s.id)}
                            onChange={(e) => {
                              if (e.target.checked) setPostTargetShopIds([...postTargetShopIds, s.id]);
                              else setPostTargetShopIds(postTargetShopIds.filter(id => id !== s.id));
                            }} className="w-3.5 h-3.5" />
                          <span className="text-xs text-slate-700">{s.name}</span>
                        </label>
                      ))}
                      <button onClick={() => setPostStep(2)} disabled={postTargetShopIds.length === 0}
                        className="mt-2 px-4 py-2 rounded-lg text-xs font-semibold bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50">
                        {postTargetShopIds.length}店舗を選択して次へ
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* Step 2: 投稿種類の選択 */}
              {postStep === 2 && (
                <div className="bg-white rounded-xl p-5 shadow-sm border border-blue-200">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-sm font-semibold text-[#003D6B]">Step 2: 投稿種類を選択</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        対象: {postTargetMode === "all" ? `全${shops.length}店舗` : postTargetMode === "selected" ? `${postTargetShopIds.length}店舗` : selectedShop?.name || ""}
                      </p>
                    </div>
                    <button onClick={() => { setPostStep(1); setPostSelectedType(""); }}
                      className="text-xs text-slate-400 hover:text-slate-600">← 店舗選択に戻る</button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { type: "STANDARD", label: "最新情報を追加", desc: "通常の投稿", color: "border-blue-200 hover:bg-blue-50" },
                      { type: "OFFER", label: "特典を追加", desc: "クーポン・割引", color: "border-amber-200 hover:bg-amber-50" },
                      { type: "EVENT", label: "イベントを追加", desc: "イベント告知", color: "border-purple-200 hover:bg-purple-50" },
                      { type: "PHOTO", label: "写真", desc: "写真のみ投稿", color: "border-emerald-200 hover:bg-emerald-50" },
                    ].map((item) => (
                      <button key={item.type} onClick={() => {
                        setPostSelectedType(item.type);
                        setNewPost({ ...newPost, topicType: item.type === "PHOTO" ? "STANDARD" : item.type, mediaType: item.type === "PHOTO" ? "PHOTO" : newPost.mediaType });
                        setShowCreate(true);
                      }}
                        className={`p-4 rounded-xl border-2 ${item.color} text-left transition-all hover:shadow-md`}>
                        <p className="text-sm font-semibold text-slate-800">{item.label}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">{item.desc}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step 3: シート自動投稿/AI一括生成/新規投稿フォーム */}
          {showCreate && (
          <>
          {/* シートから自動投稿 */}
          <div className="bg-blue-50 rounded-xl shadow-sm border border-blue-200 p-4 mb-5">
            <button onClick={() => setShowAutoPost(!showAutoPost)}
              className="flex items-center justify-between w-full">
              <h3 className="text-sm font-semibold text-slate-500">シートから自動投稿</h3>
              <span className="text-xs text-slate-400">{showAutoPost ? "▲ 閉じる" : "▼ 開く"}</span>
            </button>
            {showAutoPost && (
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">スプレッドシートID</label>
                    <input type="text" value={autoPostSheet}
                      onChange={(e) => { setAutoPostSheet(e.target.value); localStorage.setItem("auto-post-sheet", e.target.value); }}
                      placeholder="1bF-gXP05a3yoi..."
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs font-mono" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">対象日付</label>
                    <input type="date" value={autoPostDate}
                      onChange={(e) => setAutoPostDate(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div className="flex items-end gap-2">
                    <button onClick={async () => {
                      setAutoPosting(true); setAutoPostResult(null);
                      try {
                        const res = await api.post("/api/report/auto-post", { sheetId: autoPostSheet, targetDate: autoPostDate, dryRun: true, topicType: postSelectedType || newPost.topicType }, { timeout: 60000 });
                        setAutoPostResult({ ...res.data, mode: "preview" });
                      } catch (e: any) { setAutoPostResult({ error: e?.response?.data?.error || e?.message }); }
                      finally { setAutoPosting(false); }
                    }} disabled={autoPosting}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">
                      {autoPosting ? "確認中..." : "プレビュー"}
                    </button>
                    <button onClick={async () => {
                      // まずプレビューで件数を取得
                      setAutoPosting(true); setAutoPostResult(null);
                      try {
                        const previewRes = await api.post("/api/report/auto-post", { sheetId: autoPostSheet, targetDate: autoPostDate, dryRun: true, topicType: postSelectedType || newPost.topicType, batchSize: 10 }, { timeout: 60000 });
                        const total = previewRes.data.matches || 0;
                        if (total === 0) { setAutoPostResult({ error: `${autoPostDate}に該当する投稿がありません` }); setAutoPosting(false); return; }
                        if (!confirm(`${autoPostDate}の投稿を実行しますか？\n\n${total}件を10件ずつバッチ処理します（${Math.ceil(total / 10)}回）`)) { setAutoPosting(false); return; }

                        // バッチ分割実行
                        const bs = 10;
                        let totalPosted = 0, totalErrors = 0;
                        const allResults: any[] = [];
                        for (let offset = 0; offset < total; offset += bs) {
                          setMsg(`バッチ実行中... ${offset}/${total}件完了（${totalPosted}件投稿済み）`);
                          try {
                            const res = await api.post("/api/report/auto-post", {
                              sheetId: autoPostSheet, targetDate: autoPostDate,
                              topicType: postSelectedType || newPost.topicType,
                              batchOffset: offset, batchSize: bs,
                            }, { timeout: 180000 });
                            totalPosted += res.data.posted || 0;
                            totalErrors += res.data.errors || 0;
                            if (res.data.results) allResults.push(...res.data.results);
                          } catch (e: any) {
                            totalErrors++;
                            allResults.push({ shopName: `バッチ${Math.floor(offset / bs) + 1}`, status: `エラー: ${e?.message}` });
                          }
                        }
                        setAutoPostResult({ mode: "executed", posted: totalPosted, errors: totalErrors, results: allResults, matches: total });
                        logAudit("シート自動投稿", `${autoPostDate} — ${totalPosted}件投稿（${Math.ceil(total / bs)}バッチ）`);
                        setMsg(`完了: ${totalPosted}件投稿 / ${totalErrors}件エラー`);
                        await fetchData();
                      } catch (e: any) { setAutoPostResult({ error: e?.response?.data?.error || e?.message }); }
                      finally { setAutoPosting(false); }
                    }} disabled={autoPosting}
                      className="px-4 py-2 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700" style={{ color: "#fff" }}>
                      {autoPosting ? "投稿中..." : "自動投稿を実行"}
                    </button>
                  </div>
                </div>
                <p className="text-[10px] text-slate-400">タブ「投稿用シート」「報告必須店舗 投稿用シート」「WHITE 系列 投稿用シート」のB列=店舗名、C列=投稿本文、E列=日付、F列=写真URL</p>

                {autoPostResult && (
                  <div className={`rounded-lg p-3 text-sm ${autoPostResult.error ? "bg-red-50 text-red-700 border border-red-200" : autoPostResult.mode === "preview" ? "bg-blue-50 text-blue-700 border border-blue-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                    {autoPostResult.error ? (
                      <p>エラー: {autoPostResult.error}</p>
                    ) : autoPostResult.mode === "preview" ? (
                      <>
                        <p className="font-semibold mb-2">プレビュー: {autoPostResult.matches}件マッチ</p>
                        {autoPostResult.data?.map((d: any, i: number) => (
                          <div key={i} className="py-2 border-t border-blue-100">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-medium">{d.shopName}</span>
                              <span className="text-xs text-blue-500 truncate flex-1">{d.summary.slice(0, 40)}...</span>
                              {d.photoUrl ? <span className="text-[10px] text-emerald-500 font-semibold">写真あり</span> : <span className="text-[10px] text-red-400">写真なし</span>}
                              <span className="text-[10px] text-blue-400">{d.tab}</span>
                            </div>
                            {d.rawPhotoCell && <p className="text-[9px] text-slate-400 mt-0.5 truncate">F列: {d.rawPhotoCell.slice(0, 100)}</p>}
                            {d.photoDebug && <p className={`text-[9px] mt-0.5 ${d.photoUrl ? "text-emerald-500" : "text-red-400"}`}>{d.photoDebug}</p>}
                            {d.photoUrl && <p className="text-[9px] text-emerald-500 mt-0.5 truncate">写真URL: {d.photoUrl.slice(0, 80)}</p>}
                          </div>
                        ))}
                      </>
                    ) : (
                      <>
                        <p className="font-semibold mb-2">実行結果: {autoPostResult.posted}件投稿 / {autoPostResult.errors}件エラー</p>
                        {autoPostResult.results?.map((r: any, i: number) => (
                          <div key={i} className="py-1.5 border-t border-emerald-100">
                            <div className="flex items-center gap-3">
                              <span className="text-xs font-medium">{r.shopName}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.status.includes("成功") ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>{r.status}</span>
                            </div>
                            {r.detail && <p className="text-[9px] text-red-400 mt-0.5 break-all">{r.detail}</p>}
                            {r.locationName && <p className="text-[9px] text-slate-400 mt-0.5">Location: {r.locationName}</p>}
                            {r.gbpPostName && <p className="text-[9px] text-emerald-500 mt-0.5">Post ID: {r.gbpPostName}</p>}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 一括AI記事生成 */}
          <div className="bg-amber-50 rounded-xl shadow-sm border border-amber-200 p-4 mb-5">
            <button onClick={() => setShowBulkGen(!showBulkGen)}
              className="flex items-center justify-between w-full">
              <h3 className="text-sm font-semibold text-slate-500">AI一括記事生成（全店舗）</h3>
              <span className="text-xs text-slate-400">{showBulkGen ? "▲ 閉じる" : "▼ 開く"}</span>
            </button>
            {showBulkGen && (
              <div className="mt-4 space-y-3">
                <p className="text-[10px] text-slate-400">選択中の店舗 or 全店舗に対してAIが投稿文を生成し、予約投稿に追加します</p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">開始日</label>
                    <input type="date" value={bulkGenStart} onChange={(e) => setBulkGenStart(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">1店舗あたりの記事数</label>
                    <select value={bulkGenCount} onChange={(e) => setBulkGenCount(parseInt(e.target.value))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                      <option value={2}>2件</option><option value={4}>4件（推奨）</option>
                      <option value={6}>6件</option><option value={8}>8件</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button onClick={async () => {
                      const targetIds = isAllMode ? shops.map(s => s.id) : selectedShopId ? [selectedShopId] : [];
                      if (targetIds.length === 0) { setMsg("店舗を選択してください"); return; }
                      if (!confirm(`${targetIds.length}店舗 × ${bulkGenCount}件 = 最大${targetIds.length * bulkGenCount}件の記事を生成して予約投稿に追加しますか？`)) return;
                      setBulkGenning(true); setBulkGenResult(null);
                      try {
                        const token = (await supabase.auth.getSession()).data.session?.access_token;
                        const res = await fetch("/api/report/bulk-generate", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                          body: JSON.stringify({ shopIds: targetIds, startDate: bulkGenStart, postsPerShop: bulkGenCount }),
                        });
                        setBulkGenResult(await res.json());
                      } catch (e: any) { setBulkGenResult({ error: e.message }); }
                      setBulkGenning(false);
                    }} disabled={bulkGenning}
                      className={`px-5 py-2 rounded-lg text-xs font-semibold w-full ${bulkGenning ? "bg-slate-200 text-slate-400" : "bg-purple-600 hover:bg-purple-700"}`}
                      style={{ color: bulkGenning ? undefined : "#fff" }}>
                      {bulkGenning ? "生成中..." : `${isAllMode ? "全店舗" : "この店舗"}で一括生成`}
                    </button>
                  </div>
                </div>
                {bulkGenResult && (
                  <div className={`rounded-lg p-3 text-sm ${bulkGenResult.error ? "bg-red-50 text-red-700 border border-red-200" : "bg-emerald-50 text-emerald-700 border border-emerald-200"}`}>
                    {bulkGenResult.error ? (
                      <p>エラー: {bulkGenResult.error}</p>
                    ) : (
                      <>
                        <p className="font-semibold mb-2">{bulkGenResult.totalShops}店舗、{bulkGenResult.totalGenerated}件の記事を予約投稿に追加</p>
                        {bulkGenResult.results?.map((r: any, i: number) => (
                          <div key={i} className="flex items-center gap-3 py-1 border-t border-emerald-100">
                            <span className="text-xs">{r.shopName}</span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.generated > 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                              {r.generated > 0 ? `${r.generated}件生成` : r.error || "0件"}
                            </span>
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Step 3表示中: 対象店舗+種類+戻るボタン */}
          {showCreate && (
            <div className="flex items-center justify-between mb-3 bg-blue-50 rounded-lg px-4 py-2 border border-blue-200">
              <p className="text-xs text-blue-700 font-medium">
                対象: {postTargetMode === "all" ? `全${shops.length}店舗` : postTargetMode === "selected" ? `${postTargetShopIds.length}店舗` : selectedShop?.name || ""} / {postSelectedType === "PHOTO" ? "写真投稿" : TOPIC_STYLES[newPost.topicType]?.label || "通常投稿"}
              </p>
              <button onClick={() => { setShowCreate(false); setPostSelectedType(""); setPostStep(2); }}
                className="text-xs text-blue-500 hover:text-blue-700 font-semibold">← 種類選択に戻る</button>
            </div>
          )}

          {/* 新規投稿フォーム */}
            <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 mb-6">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">新規GBP投稿</h3>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿タイプ</label>
                  <select value={newPost.topicType} onChange={(e) => setNewPost({ ...newPost, topicType: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    <option value="STANDARD">通常投稿</option><option value="EVENT">イベント</option>
                    <option value="OFFER">特典</option><option value="ALERT">お知らせ</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿本文 *</label>
                  <div className="relative flex gap-2">
                    <textarea value={newPost.summary} onChange={(e) => setNewPost({ ...newPost, summary: e.target.value })}
                      placeholder="投稿の内容を入力..." className="flex-1 border border-slate-200 rounded-lg px-4 py-3 text-sm min-h-[120px] resize-y focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20" />
                    {fixedMessages.length > 0 && (
                      <div className="relative">
                        <button type="button" onClick={() => setShowInsertMenu(!showInsertMenu)}
                          className="px-3 py-2 text-xs font-semibold border border-slate-300 rounded-lg hover:bg-slate-50 whitespace-nowrap h-fit">
                          差し込み
                        </button>
                        {showInsertMenu && (
                          <div className="absolute right-0 top-10 z-50 bg-white border border-slate-200 rounded-lg shadow-lg p-3 w-64">
                            <p className="text-xs font-bold text-slate-600 mb-1">差し込み文字列</p>
                            <p className="text-[10px] text-slate-400 mb-2">追加したい文字列を選択してください</p>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {fixedMessages.map((fm) => (
                                <button key={fm.id} type="button" onClick={() => {
                                  setNewPost(prev => ({ ...prev, summary: prev.summary + fm.message }));
                                  setShowInsertMenu(false);
                                }}
                                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-blue-50 hover:text-blue-700 transition">
                                  {fm.title}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-xs text-slate-400">{newPost.summary.length} / 1500文字</p>
                    <div className="flex items-center gap-1.5 ml-auto">
                      {/* AI校正 */}
                      {newPost.summary.trim().length > 10 && (
                        <button onClick={async () => {
                          setProofing(true); setProofResult(null);
                          try {
                            const token = (await supabase.auth.getSession()).data.session?.access_token;
                            const res = await fetch("/api/report/generate-post", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                              body: JSON.stringify({ shopName: selectedShop?.name || "", topicType: "PROOF", keywords: newPost.summary }),
                            });
                            const data = await res.json();
                            setProofResult(data.posts?.[0] || "修正なし");
                          } catch { setProofResult("校正に失敗しました"); }
                          setProofing(false);
                        }} disabled={proofing}
                          className="text-[10px] px-2 py-1 rounded bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 font-semibold">
                          {proofing ? "校正中..." : "AI校正"}
                        </button>
                      )}
                      {/* 翻訳 */}
                      {newPost.summary.trim().length > 10 && (
                        <select onChange={async (e) => {
                          const lang = e.target.value;
                          if (!lang) return;
                          e.target.value = "";
                          setProofing(true); setProofResult(null);
                          try {
                            const token = (await supabase.auth.getSession()).data.session?.access_token;
                            const res = await fetch("/api/report/generate-post", {
                              method: "POST",
                              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                              body: JSON.stringify({ shopName: "", topicType: "TRANSLATE", keywords: newPost.summary, targetLang: lang }),
                            });
                            const data = await res.json();
                            setProofResult(data.posts?.[0] || "翻訳に失敗しました");
                          } catch { setProofResult("翻訳に失敗しました"); }
                          setProofing(false);
                        }} className="text-[10px] px-1 py-1 rounded bg-blue-50 text-blue-600 border border-blue-200 font-semibold">
                          <option value="">翻訳...</option>
                          <option value="英語">英語</option>
                          <option value="韓国語">韓国語</option>
                          <option value="簡体字中国語">中国語</option>
                        </select>
                      )}
                      {/* AI生成 */}
                      <button onClick={async () => {
                        setAiGenerating(true); setAiPosts([]);
                        try {
                          const token = (await supabase.auth.getSession()).data.session?.access_token;
                          const res = await fetch("/api/report/generate-post", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                            body: JSON.stringify({
                              shopName: selectedShop?.name || "",
                              topicType: newPost.topicType,
                              keywords: aiKeywords || undefined,
                              count: 3,
                            }),
                          });
                          const data = await res.json();
                          setAiPosts(data.posts || []);
                        } catch { setMsg("AI生成に失敗しました"); }
                        setAiGenerating(false);
                      }} disabled={aiGenerating}
                        className="text-[10px] px-2 py-1 rounded bg-purple-50 text-purple-600 border border-purple-200 hover:bg-purple-100 font-semibold">
                        {aiGenerating ? "生成中..." : "AI文章生成"}
                      </button>
                    </div>
                  </div>
                  {/* AI生成キーワード入力 */}
                  <input type="text" value={aiKeywords} onChange={(e) => setAiKeywords(e.target.value)}
                    placeholder="含めたいキーワード（任意: テイクアウト, ランチ 等）"
                    className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-[11px] mt-1" />
                  {/* 校正結果 */}
                  {proofResult && (
                    <div className="bg-amber-50 rounded-lg p-3 border border-amber-200 mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-[10px] text-amber-600 font-semibold">AI校正結果</p>
                        <button onClick={() => { setNewPost({ ...newPost, summary: proofResult }); setProofResult(null); }}
                          className="text-[10px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-semibold">適用</button>
                      </div>
                      <p className="text-xs text-amber-800">{proofResult}</p>
                    </div>
                  )}
                  {/* AI生成候補 */}
                  {aiPosts.length > 0 && (
                    <div className="bg-purple-50 rounded-lg p-3 border border-purple-200 mt-2">
                      <p className="text-[10px] text-purple-600 font-semibold mb-2">AI生成候補（クリックで挿入）</p>
                      <div className="space-y-2">
                        {aiPosts.map((post, i) => (
                          <div key={i} onClick={() => { setNewPost({ ...newPost, summary: post }); setAiPosts([]); }}
                            className="bg-white rounded-lg p-2.5 border border-purple-100 cursor-pointer hover:border-purple-300 transition">
                            <span className="text-[9px] text-purple-400 font-bold">候補 {i + 1}</span>
                            <p className="text-xs text-slate-700 mt-0.5">{post.slice(0, 150)}...</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <label className="text-xs text-slate-500">メディアURL（任意）</label>
                    <div className="flex border border-slate-200 rounded overflow-hidden">
                      <button type="button" onClick={() => setNewPost({ ...newPost, mediaType: "PHOTO" })}
                        className={`px-2 py-0.5 text-[10px] font-semibold ${newPost.mediaType === "PHOTO" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>写真</button>
                      <button type="button" onClick={() => setNewPost({ ...newPost, mediaType: "VIDEO" })}
                        className={`px-2 py-0.5 text-[10px] font-semibold ${newPost.mediaType === "VIDEO" ? "bg-purple-600 text-white" : "bg-white text-slate-500"}`}>動画</button>
                    </div>
                  </div>
                  <input type="text" value={newPost.photoUrl} onChange={(e) => setNewPost({ ...newPost, photoUrl: e.target.value })}
                    placeholder={newPost.mediaType === "VIDEO" ? "https://example.com/video.mp4" : "https://example.com/photo.jpg"}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  {newPost.photoUrl && newPost.mediaType === "PHOTO" && <img src={newPost.photoUrl} alt="" className="h-20 rounded-lg object-cover mt-2 border" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                  {newPost.photoUrl && newPost.mediaType === "VIDEO" && <p className="text-[10px] text-purple-600 mt-1">動画URL設定済み</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">ボタンタイプ（任意）</label>
                    <select value={newPost.actionType} onChange={(e) => setNewPost({ ...newPost, actionType: e.target.value })}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                      <option value="">なし</option><option value="BOOK">予約</option><option value="ORDER">注文</option>
                      <option value="LEARN_MORE">詳しく見る</option><option value="SIGN_UP">登録</option><option value="CALL">電話</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 block mb-1">リンクURL（任意）</label>
                    <input type="text" value={newPost.actionUrl} onChange={(e) => setNewPost({ ...newPost, actionUrl: e.target.value })}
                      placeholder="https://..." className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-500 block mb-1">投稿予約（任意）</label>
                  <input type="datetime-local" value={newPost.scheduledAt}
                    onChange={(e) => setNewPost({ ...newPost, scheduledAt: e.target.value })}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    min={new Date().toISOString().slice(0, 16)} />
                  <p className="text-[10px] text-slate-400 mt-1">{newPost.scheduledAt ? "予約モード: 指定日時にGBPへ自動投稿されます" : "空欄の場合は即時投稿"}</p>
                </div>
                {/* 系列店一括投稿 */}
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={bulkPostMode} onChange={(e) => {
                      setBulkPostMode(e.target.checked);
                      if (e.target.checked) setBulkPostShopIds(shops.map(s => s.id));
                      else setBulkPostShopIds([]);
                    }} className="rounded" />
                    <span className="text-xs font-semibold text-slate-600">系列店にも同時投稿（{shops.length}店舗）</span>
                  </label>
                  {bulkPostMode && (
                    <div className="mt-2 max-h-[100px] overflow-y-auto">
                      {shops.map(s => (
                        <label key={s.id} className="flex items-center gap-1.5 text-[10px] text-slate-500 py-0.5">
                          <input type="checkbox" checked={bulkPostShopIds.includes(s.id)}
                            onChange={(e) => setBulkPostShopIds(e.target.checked ? [...bulkPostShopIds, s.id] : bulkPostShopIds.filter(id => id !== s.id))} />
                          {s.name}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">キャンセル</button>
                  <button onClick={handleCreate} disabled={creating || !newPost.summary.trim()}
                    className={`px-6 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 ${newPost.scheduledAt ? "bg-purple-600 hover:bg-purple-700" : "bg-[#003D6B] hover:bg-[#002a4a]"}`}
                    style={{ color: "#fff" }}>
                    {creating ? "処理中..." : bulkPostMode ? `${bulkPostShopIds.length}店舗に投稿` : newPost.scheduledAt ? "予約する" : "GBPに投稿"}
                  </button>
                </div>
              </div>
            </div>
          </>
          )}

          {/* 表示切替 */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                <button onClick={() => setViewMode("list")} className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "list" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>リスト</button>
                <button onClick={() => setViewMode("calendar")} className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "calendar" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>カレンダー</button>
                <button onClick={() => setViewMode("shops")} className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "shops" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>全店舗状況</button>
                {!isAllMode && <button onClick={() => setViewMode("plan")} className={`px-4 py-1.5 text-xs font-semibold ${viewMode === "plan" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>月間計画</button>}
              </div>
              {viewMode === "list" && (
                <div className="flex border border-slate-200 rounded-lg overflow-hidden">
                  <button onClick={() => setDateSort("desc")} className={`px-3 py-1.5 text-xs font-semibold ${dateSort === "desc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>新しい順</button>
                  <button onClick={() => setDateSort("asc")} className={`px-3 py-1.5 text-xs font-semibold ${dateSort === "asc" ? "bg-[#003D6B] text-white" : "bg-white text-slate-500"}`}>古い順</button>
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400">{localPosts.length}件</p>
          </div>

          {/* 予約投稿一覧 */}
          {scheduledPosts.filter((p) => p.status === "pending").length > 0 && (
            <div className="bg-purple-50 rounded-xl shadow-sm border border-purple-200 p-4 mb-4">
              <h3 className="text-sm font-semibold text-purple-700 mb-3">予約投稿（{scheduledPosts.filter((p) => p.status === "pending").length}件）</h3>
              <div className="space-y-2">
                {scheduledPosts.filter((p) => p.status === "pending").map((sp) => (
                  <div key={sp.id} className="bg-white rounded-lg p-3 border border-purple-100">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        {editingPostId === sp.id ? (
                          <div className="space-y-2">
                            <textarea value={editingSummary} onChange={(e) => setEditingSummary(e.target.value)}
                              className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm min-h-[80px] resize-y focus:outline-none focus:ring-2 focus:ring-purple-300" />
                            <div className="flex items-center gap-2">
                              <button onClick={() => handleSaveEdit(sp.id)} disabled={savingEdit || !editingSummary.trim()}
                                className="text-[10px] font-semibold px-3 py-1 rounded bg-[#003D6B] text-white hover:bg-[#002a4a] disabled:opacity-50">
                                {savingEdit ? "保存中..." : "保存"}
                              </button>
                              <button onClick={() => { setEditingPostId(null); setEditingSummary(""); }}
                                className="text-[10px] font-semibold px-3 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200">キャンセル</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm text-slate-700 truncate">{sp.summary}</p>
                            <p className="text-xs text-purple-600 mt-0.5">
                              {new Date(sp.scheduled_at).toLocaleString("ja-JP")} に投稿予定
                              {sp.shop_name && !isAllMode ? "" : ` — ${sp.shop_name}`}
                            </p>
                          </>
                        )}
                      </div>
                      {editingPostId !== sp.id && (
                        <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
                          <button onClick={() => { setEditingPostId(sp.id); setEditingSummary(sp.summary); }}
                            className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold bg-blue-50 px-2 py-0.5 rounded">編集</button>
                          {sp.approval_status !== "approved" && (
                            <button onClick={async () => {
                              await supabase.from("scheduled_posts").update({ approval_status: "approved" }).eq("id", sp.id);
                              setScheduledPosts(scheduledPosts.map(p => p.id === sp.id ? { ...p, approval_status: "approved" } : p));
                              setMsg("承認しました");
                            }} className="text-[10px] text-emerald-600 hover:text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded">承認</button>
                          )}
                          {sp.approval_status === "approved" && (
                            <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 px-2 py-0.5 rounded">承認済</span>
                          )}
                          <button onClick={async () => {
                            await supabase.from("scheduled_posts").update({ approval_status: "rejected", status: "rejected" }).eq("id", sp.id);
                            setScheduledPosts(scheduledPosts.filter(p => p.id !== sp.id));
                            setMsg("差戻ししました");
                          }} className="text-[10px] text-amber-600 hover:text-amber-800 font-semibold bg-amber-50 px-2 py-0.5 rounded">差戻し</button>
                          <button onClick={async () => {
                            if (!confirm("この予約を取り消しますか？")) return;
                            await api.delete("/api/report/scheduled-posts", { data: { id: sp.id } });
                            setScheduledPosts(scheduledPosts.filter((p) => p.id !== sp.id));
                            setMsg("予約を取り消しました");
                          }} className="text-[10px] text-red-500 hover:text-red-700 font-semibold">取消</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={async () => {
                try {
                  const res = await api.put("/api/report/scheduled-posts", {}, { timeout: 120000 });
                  setMsg(`${res.data.executed}件の予約投稿を実行しました${res.data.errors > 0 ? `（エラー${res.data.errors}件）` : ""}`);
                  const sRes = await api.get(`/api/report/scheduled-posts${selectedShopId ? `?shopId=${selectedShopId}` : ""}`);
                  setScheduledPosts(Array.isArray(sRes.data) ? sRes.data : []);
                  await fetchData();
                } catch (e: any) { setMsg(`実行失敗: ${e?.message}`); }
              }} className="mt-3 px-4 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-700" style={{ color: "#fff" }}>
                予約投稿を今すぐ実行
              </button>
            </div>
          )}

          {/* エラー投稿一覧 */}
          {scheduledPosts.filter((p) => p.status === "error").length > 0 && (
            <div className="bg-red-50 rounded-xl shadow-sm border border-red-200 p-4 mb-4">
              <h3 className="text-sm font-semibold text-red-700 mb-3">エラー投稿（{scheduledPosts.filter((p) => p.status === "error").length}件）</h3>
              <div className="space-y-2">
                {scheduledPosts.filter((p) => p.status === "error").map((sp) => (
                  <div key={sp.id} className="bg-white rounded-lg p-3 border border-red-100">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-700 truncate">{sp.summary}</p>
                        <p className="text-xs text-red-500 mt-0.5">
                          {sp.error_detail || "不明なエラー"}
                          {sp.shop_name && ` — ${sp.shop_name}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 ml-3 flex-shrink-0">
                        <button onClick={() => handleRetry(sp.id)} disabled={retrying === sp.id}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-semibold bg-blue-50 px-2 py-0.5 rounded disabled:opacity-50">
                          {retrying === sp.id ? "処理中..." : "再実行"}
                        </button>
                        <button onClick={async () => {
                          if (!confirm("このエラー投稿を削除しますか？")) return;
                          await api.delete("/api/report/scheduled-posts", { data: { id: sp.id } });
                          setScheduledPosts(scheduledPosts.filter((p) => p.id !== sp.id));
                          setMsg("削除しました");
                        }} className="text-[10px] text-red-500 hover:text-red-700 font-semibold">削除</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center"><p className="text-slate-400 text-sm">読み込み中...</p></div>
          ) : viewMode === "plan" ? (
            /* 月間投稿計画 */
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-slate-500">月間投稿計画</h3>
                <input type="month" value={planMonth} onChange={(e) => setPlanMonth(e.target.value)}
                  className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm" />
              </div>
              {planLoading ? (
                <p className="text-center text-slate-400 text-sm py-8">読み込み中...</p>
              ) : (() => {
                const year = parseInt(planMonth.split("-")[0]);
                const month = parseInt(planMonth.split("-")[1]);
                const days = new Date(year, month, 0).getDate();
                const firstWeekday = new Date(year, month - 1, 1).getDay();
                const planByDay: Record<number, typeof planItems[0]> = {};
                planItems.forEach((p) => {
                  const d = new Date(p.date).getDate();
                  planByDay[d] = p;
                });
                // 実績も表示
                const postsByDayPlan: Record<number, number> = {};
                localPosts.forEach((p) => {
                  if (!p.createTime) return;
                  const d = new Date(p.createTime);
                  if (d.getFullYear() === year && d.getMonth() === month - 1) {
                    postsByDayPlan[d.getDate()] = (postsByDayPlan[d.getDate()] || 0) + 1;
                  }
                });
                return (
                  <>
                    <div className="grid grid-cols-7 gap-0 text-center text-[10px] text-slate-400 mb-1">
                      {["日","月","火","水","木","金","土"].map((d) => <div key={d} className="py-1">{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-1">
                      {Array.from({ length: firstWeekday }).map((_, i) => <div key={`e${i}`} />)}
                      {Array.from({ length: days }).map((_, i) => {
                        const day = i + 1;
                        const plan = planByDay[day];
                        const actualCount = postsByDayPlan[day] || 0;
                        const isPast = new Date(year, month - 1, day) < new Date(new Date().toDateString());
                        const style = plan ? TOPIC_STYLES[plan.post_type] || TOPIC_STYLES.STANDARD : null;
                        return (
                          <div key={day}
                            onClick={() => {
                              if (planEditDay === day) { setPlanEditDay(null); return; }
                              setPlanEditDay(day);
                              setPlanEditType(plan?.post_type || "STANDARD");
                              setPlanEditNote(plan?.note || "");
                            }}
                            className={`border rounded-lg p-1.5 min-h-[70px] cursor-pointer transition hover:border-[#003D6B] ${
                              planEditDay === day ? "border-[#003D6B] bg-blue-50" : "border-slate-100"
                            } ${isPast ? "opacity-60" : ""}`}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs text-slate-600 font-medium">{day}</span>
                              {actualCount > 0 && <span className="text-[8px] bg-emerald-100 text-emerald-700 px-1 rounded font-bold">{actualCount}件済</span>}
                            </div>
                            {plan && style && (
                              <div className={`${style.bg} ${style.text} rounded px-1 py-0.5 text-[9px] font-semibold text-center`}>
                                {style.label}
                              </div>
                            )}
                            {plan?.note && <p className="text-[8px] text-slate-400 mt-0.5 truncate">{plan.note}</p>}
                          </div>
                        );
                      })}
                    </div>

                    {/* 編集パネル */}
                    {planEditDay && (
                      <div className="mt-4 bg-slate-50 rounded-lg p-4 border border-slate-200">
                        <h4 className="text-xs font-semibold text-slate-600 mb-3">{planMonth}-{String(planEditDay).padStart(2, "0")} の投稿計画</h4>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">投稿種類</label>
                            <select value={planEditType} onChange={(e) => setPlanEditType(e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs">
                              <option value="STANDARD">通常投稿</option>
                              <option value="EVENT">イベント</option>
                              <option value="OFFER">特典</option>
                              <option value="ALERT">お知らせ</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] text-slate-500 block mb-1">メモ</label>
                            <input type="text" value={planEditNote} onChange={(e) => setPlanEditNote(e.target.value)}
                              placeholder="例: 新商品紹介" className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs" />
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => savePlanItem(planEditDay, planEditType, planEditNote)}
                            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-[#003D6B] hover:bg-[#002a4a]" style={{ color: "#fff" }}>
                            保存
                          </button>
                          {planByDay[planEditDay]?.id && (
                            <button onClick={() => { if (planByDay[planEditDay]?.id) deletePlanItem(planByDay[planEditDay].id!); }}
                              className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100">
                              削除
                            </button>
                          )}
                          <button onClick={() => setPlanEditDay(null)}
                            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600">
                            キャンセル
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 統計 */}
                    <div className="flex items-center gap-4 mt-4 pt-3 border-t border-slate-100">
                      <span className="text-xs text-slate-500">計画: <span className="font-bold text-[#003D6B]">{planItems.length}</span>件</span>
                      <span className="text-xs text-slate-500">実績: <span className="font-bold text-emerald-600">{Object.values(postsByDayPlan).reduce((a, b) => a + b, 0)}</span>件</span>
                      <span className="text-xs text-slate-500">達成率: <span className={`font-bold ${planItems.length > 0 && Object.keys(postsByDayPlan).length / planItems.length >= 0.8 ? "text-emerald-600" : "text-amber-600"}`}>
                        {planItems.length > 0 ? Math.round((Object.keys(postsByDayPlan).length / planItems.length) * 100) : 0}%
                      </span></span>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : viewMode === "shops" ? (
            /* 全店舗投稿状況 */
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left p-3 text-slate-500 font-medium">店舗名</th>
                    <th className="text-center p-3 text-slate-500 font-medium">投稿数</th>
                    <th className="text-center p-3 text-slate-500 font-medium">最終投稿</th>
                    <th className="text-center p-3 text-slate-500 font-medium">ステータス</th>
                  </tr>
                </thead>
                <tbody>
                  {shopPostCounts.sort((a, b) => a.count - b.count).map((s, i) => {
                    const daysSince = s.lastPost ? Math.floor((Date.now() - new Date(s.lastPost).getTime()) / (24 * 60 * 60 * 1000)) : 999;
                    return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="p-3 font-medium text-slate-800">{s.name}</td>
                        <td className="p-3 text-center font-bold text-slate-700">{s.count}</td>
                        <td className="p-3 text-center text-slate-500">{s.lastPost ? new Date(s.lastPost).toLocaleDateString("ja-JP") : "—"}</td>
                        <td className="p-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            s.count === 0 ? "bg-red-50 text-red-600"
                            : daysSince > 14 ? "bg-amber-50 text-amber-600"
                            : "bg-emerald-50 text-emerald-600"
                          }`}>
                            {s.count === 0 ? "未投稿" : daysSince > 14 ? `${daysSince}日前` : "最新"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : viewMode === "calendar" ? (
            /* カレンダー */
            <div className="bg-white rounded-xl shadow-sm border border-slate-100 p-5">
              <h3 className="text-sm font-semibold text-slate-500 mb-4">{now.getFullYear()}年{now.getMonth() + 1}月</h3>
              <div className="grid grid-cols-7 gap-1">
                {["日","月","火","水","木","金","土"].map((d) => <div key={d} className="text-center text-xs font-semibold text-slate-400 py-2">{d}</div>)}
                {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e${i}`} className="aspect-square" />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dp = postsByDay[day] || [];
                  const isToday = day === now.getDate();
                  return (
                    <div key={day} className={`aspect-square border rounded-lg p-1 flex flex-col ${isToday ? "border-blue-400 bg-blue-50" : "border-slate-100"} ${dp.length > 0 ? "bg-emerald-50" : ""}`}>
                      <span className={`text-[10px] font-medium ${isToday ? "text-blue-600" : "text-slate-500"}`}>{day}</span>
                      {dp.length > 0 && <div className="flex flex-wrap gap-0.5 mt-auto">
                        {dp.map((p, j) => { const s = TOPIC_STYLES[p.topicType || "STANDARD"]; return <div key={j} className={`w-2 h-2 rounded-full ${s.text.replace("text-","bg-")}`} title={p.summary?.slice(0,30)} />; })}
                      </div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : localPosts.length === 0 ? (
            <div className="bg-white rounded-xl p-12 shadow-sm border border-slate-100 text-center">
              <p className="text-slate-400 text-sm">GBP投稿がありません。「+ 新規投稿」から作成してください。</p>
            </div>
          ) : (
            /* リストビュー（プレビュー+確認ステータス+削除） */
            <div className="space-y-3">
              {sorted.map((post, i) => {
                const s = TOPIC_STYLES[post.topicType || "STANDARD"] || TOPIC_STYLES.STANDARD;
                const key = postKey(post, i);
                const status = confirmMap[key] || "unconfirmed";
                const ss = STATUS_STYLES[status];
                let photoUrl = post.media?.[0]?.googleUrl || post.media?.[0]?.sourceUrl || "";
                // Dropbox URL修正
                if (photoUrl.includes("dropbox.com")) {
                  photoUrl = photoUrl.replace("dl=0", "raw=1");
                  if (!photoUrl.includes("raw=1") && !photoUrl.includes("dl=1")) {
                    photoUrl += (photoUrl.includes("?") ? "&" : "?") + "raw=1";
                  }
                }
                return (
                  <div key={i} className={`bg-white rounded-xl shadow-sm border overflow-hidden ${status === "needs_fix" ? "border-red-200" : status === "confirmed" ? "border-emerald-200" : "border-slate-100"}`}>
                    <div className="flex">
                      {/* 写真プレビュー */}
                      {photoUrl && (
                        <div className="w-32 flex-shrink-0 bg-slate-100">
                          <img src={photoUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                        </div>
                      )}
                      <div className="flex-1 p-4">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg} ${s.text}`}>{s.label}</span>
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ss.bg} ${ss.text}`}>{ss.label}</span>
                            {post._fromLog && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-400">ログ</span>}
                            {isAllMode && post._shopName && <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-50 text-slate-500">{post._shopName}</span>}
                          </div>
                          <span className="text-xs text-slate-400">{post.createTime ? new Date(post.createTime).toLocaleDateString("ja-JP") : ""}</span>
                        </div>
                        <p className="text-sm text-slate-700 mb-2">{post.summary || "（本文なし）"}</p>
                        {post.callToAction?.url && (
                          <a href={post.callToAction.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mb-2 inline-block">
                            {post.callToAction.actionType || "リンク"} →
                          </a>
                        )}
                        {/* アクションボタン */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <button onClick={() => setConfirm(key, "confirmed")}
                            className={`px-2 py-1 rounded text-[10px] font-semibold transition ${status === "confirmed" ? "bg-emerald-600 text-white" : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"}`}>
                            確認OK
                          </button>
                          <button onClick={() => setConfirm(key, "needs_fix")}
                            className={`px-2 py-1 rounded text-[10px] font-semibold transition ${status === "needs_fix" ? "bg-red-600 text-white" : "bg-red-50 text-red-600 hover:bg-red-100"}`}>
                            要修正
                          </button>
                          <button onClick={() => setConfirm(key, "unconfirmed")}
                            className="px-2 py-1 rounded text-[10px] font-semibold bg-slate-50 text-slate-400 hover:bg-slate-100">
                            リセット
                          </button>
                          <div className="flex items-center gap-1.5 ml-auto">
                            {post.searchUrl ? (
                              <a href={post.searchUrl} target="_blank" rel="noopener noreferrer"
                                className="px-2 py-1 rounded text-[10px] font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100">
                                投稿を見る →
                              </a>
                            ) : (
                              <a href={`https://www.google.com/search?q=${encodeURIComponent((isAllMode ? post._shopName : selectedShop?.name) || "")}`}
                                target="_blank" rel="noopener noreferrer"
                                className="px-2 py-1 rounded text-[10px] font-semibold bg-slate-50 text-slate-500 hover:bg-slate-100">
                                Google検索 →
                              </a>
                            )}
                            {post.name && (
                              <button onClick={() => handleDelete(post.name!)}
                                className="px-2 py-1 rounded text-[10px] font-semibold bg-red-50 text-red-500 hover:bg-red-100">
                                削除
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
