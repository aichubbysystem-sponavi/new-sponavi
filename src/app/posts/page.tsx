"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import Link from "next/link";
import { scheduledPosts as mockPosts, postCalendar } from "@/lib/mock-data";
import { featureDetails } from "@/lib/feature-details";
import api from "@/lib/api";
import { useShop } from "@/components/shop-provider";

const postTypes = ["通常投稿", "特典投稿", "イベント投稿", "写真投稿", "多言語投稿"];

interface Post {
  id: number;
  date: string;
  time: string;
  type: string;
  title: string;
  content: string;
  status: string;
  platform: string;
}

export default function PostsPage() {
  const [showGenerator, setShowGenerator] = useState(false);
  const [showNewPost, setShowNewPost] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedText, setGeneratedText] = useState("");
  const { selectedShopId } = useShop();
  const [posts, setPosts] = useState<Post[]>(mockPosts);
  const [filter, setFilter] = useState("すべて");

  // Go APIから投稿データを取得
  const fetchPosts = useCallback(async () => {
    if (!selectedShopId) return;
    try {
      const res = await api.get(`/api/shop/${selectedShopId}/post/reservation`);
      if (Array.isArray(res.data) && res.data.length > 0) {
        setPosts(res.data);
      }
    } catch {
      // API未接続時はモックデータ
    }
  }, [selectedShopId]);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [newPost, setNewPost] = useState({ title: "", content: "", type: "通常投稿", date: "", time: "12:00", platform: "GBP" });

  // カレンダーの日数を動的に計算
  const calendarDays = useMemo(() => {
    const { year, month } = calendarMonth;
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return { firstDay, daysInMonth };
  }, [calendarMonth]);

  const monthLabel = `${calendarMonth.year}年${calendarMonth.month + 1}月`;

  const filteredPosts = posts.filter((p) => {
    if (filter === "すべて") return true;
    if (filter === "予約済み") return p.status === "scheduled";
    if (filter === "下書き") return p.status === "draft";
    if (filter === "公開済み") return p.status === "published";
    return true;
  });

  const handleAddPost = async () => {
    const post: Post = {
      id: posts.length + 1,
      ...newPost,
      status: "scheduled",
    };
    // APIに送信を試みる
    if (selectedShopId) {
      try {
        await api.post(`/api/shop/${selectedShopId}/post/reservation`, {
          title: newPost.title,
          content: newPost.content,
          type: newPost.type,
          scheduled_date: newPost.date,
          scheduled_time: newPost.time,
          platform: newPost.platform,
        });
        await fetchPosts();
      } catch {
        // API失敗時はローカルに追加
        setPosts([post, ...posts]);
      }
    } else {
      setPosts([post, ...posts]);
    }
    setShowNewPost(false);
    setNewPost({ title: "", content: "", type: "通常投稿", date: "", time: "12:00", platform: "GBP" });
  };

  const handleDeletePost = (id: number) => {
    setPosts(posts.filter((p) => p.id !== id));
  };

  const handleGenerate = () => {
    setGenerating(true);
    setGeneratedText("");
    // Simulate AI generation
    const fullText = "🔥 本日のおすすめは、当店自慢のA5ランク黒毛和牛の特選盛り合わせです！\n\n渋谷で極上の焼肉をお探しなら、ぜひ焼肉ダイニング炎へ。職人が厳選した最高品質のお肉を、こだわりの炭火でお楽しみいただけます。\n\nカルビ・ハラミ・タン塩など、人気部位を贅沢に盛り合わせた「炎スペシャルセット」は、ディナータイム限定でご提供中。\n\n📍 渋谷区道玄坂1-2-3\n📞 03-1234-5678\n⏰ 17:00-23:00（L.O. 22:30）\n\n#渋谷焼肉 #焼肉ダイニング炎 #A5和牛 #渋谷グルメ #焼肉デート";
    let i = 0;
    const interval = setInterval(() => {
      if (i < fullText.length) {
        setGeneratedText(fullText.slice(0, i + 1));
        i++;
      } else {
        clearInterval(interval);
        setGenerating(false);
      }
    }, 20);
  };

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">投稿管理</h1>
          <p className="text-sm text-slate-500 mt-1">最新情報・写真の投稿と予約管理</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowGenerator(!showGenerator)}
            className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition flex items-center gap-2"
          >
            🤖 AI記事生成
          </button>
          <button onClick={() => setShowNewPost(true)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
            + 新規投稿
          </button>
        </div>
      </div>

      {/* AI Generator */}
      {showGenerator && (
        <div className="bg-white rounded-xl p-6 shadow-sm border border-purple-100 mb-6 animate-fade-in">
          <h3 className="text-sm font-semibold text-purple-700 mb-4 flex items-center gap-2">
            🤖 AI投稿文章生成
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">投稿の種類</label>
                <select className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
                  {postTypes.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">テーマ・キーワード</label>
                <input
                  type="text"
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2"
                  placeholder="例: 本日のおすすめ、A5和牛"
                  defaultValue="本日のおすすめ、A5和牛"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">トーン</label>
                <div className="flex gap-2">
                  {["カジュアル", "フォーマル", "親しみやすい"].map((t) => (
                    <button
                      key={t}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:border-purple-300 hover:bg-purple-50 transition"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="aio" defaultChecked className="rounded" />
                <label htmlFor="aio" className="text-xs text-slate-600">AIO/LLMO最適化テキストを含める</label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="kw" defaultChecked className="rounded" />
                <label htmlFor="kw" className="text-xs text-slate-600">対策キーワードを自然に含める</label>
              </div>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="w-full px-4 py-2.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition font-medium disabled:opacity-50"
              >
                {generating ? "生成中..." : "文章を生成する"}
              </button>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-600 block mb-1">生成結果</label>
              <div className="w-full h-[280px] border border-slate-200 rounded-lg p-3 bg-slate-50 text-sm whitespace-pre-wrap overflow-y-auto">
                {generatedText || (
                  <span className="text-slate-400">ここに生成された文章が表示されます...</span>
                )}
                {generating && <span className="inline-block w-0.5 h-4 bg-purple-600 animate-pulse ml-0.5" />}
              </div>
              {generatedText && !generating && (
                <div className="flex gap-2 mt-3">
                  <button className="flex-1 px-3 py-2 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition">
                    予約投稿に追加
                  </button>
                  <button className="px-3 py-2 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 transition">
                    直接投稿
                  </button>
                  <button onClick={handleGenerate} className="px-3 py-2 border border-slate-200 text-xs rounded-lg hover:bg-slate-50 transition">
                    再生成
                  </button>
                  <button className="px-3 py-2 border border-slate-200 text-xs rounded-lg hover:bg-slate-50 transition">
                    翻訳
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Calendar + Post list */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Calendar */}
        <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-4">
            <button onClick={() => setCalendarMonth((m) => { const d = new Date(m.year, m.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-slate-400 hover:text-slate-600 text-sm px-2">◀</button>
            <h3 className="text-sm font-semibold text-slate-500">{monthLabel}</h3>
            <button onClick={() => setCalendarMonth((m) => { const d = new Date(m.year, m.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })} className="text-slate-400 hover:text-slate-600 text-sm px-2">▶</button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center mb-2">
            {["日", "月", "火", "水", "木", "金", "土"].map((d) => (
              <span key={d} className="text-xs text-slate-400 font-medium py-1">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {/* 月初の空白 */}
            {Array.from({ length: calendarDays.firstDay }).map((_, i) => (
              <div key={`empty-${i}`} />
            ))}
            {Array.from({ length: calendarDays.daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = `${calendarMonth.year}-${String(calendarMonth.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const post = postCalendar.find((p) => p.date === dateStr);
              const hasPost = posts.some((p) => p.date === dateStr);
              const today = new Date();
              const isToday = day === today.getDate() && calendarMonth.month === today.getMonth() && calendarMonth.year === today.getFullYear();
              return (
                <div
                  key={day}
                  className={`py-1.5 rounded-lg text-xs relative cursor-pointer transition hover:bg-slate-50 ${
                    isToday ? "bg-blue-600 text-white hover:bg-blue-700" : "text-slate-600"
                  }`}
                >
                  {day}
                  {(post || hasPost) && (
                    <div className={`w-1.5 h-1.5 rounded-full mx-auto mt-0.5 ${
                      post?.type === "通常" ? "bg-blue-400" :
                      post?.type === "特典" ? "bg-emerald-400" :
                      post?.type === "イベント" ? "bg-purple-400" :
                      "bg-amber-400"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-4 space-y-1">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-2 h-2 rounded-full bg-blue-400" /> 通常投稿
              <span className="w-2 h-2 rounded-full bg-emerald-400 ml-2" /> 特典
              <span className="w-2 h-2 rounded-full bg-purple-400 ml-2" /> イベント
              <span className="w-2 h-2 rounded-full bg-amber-400 ml-2" /> 写真
            </div>
          </div>
        </div>

        {/* Posts list */}
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-slate-100">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-500">投稿一覧</h3>
            <div className="flex gap-2">
              {["すべて", "予約済み", "下書き", "公開済み"].map((f) => (
                <button key={f} onClick={() => setFilter(f)} className={`text-xs px-3 py-1.5 rounded-lg font-medium transition ${filter === f ? "bg-[#003D6B] text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-slate-50">
            {filteredPosts.map((post) => (
              <div key={post.id} className="p-5 hover:bg-slate-50/50 transition">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`badge ${
                        post.status === "published" ? "badge-success" :
                        post.status === "scheduled" ? "badge-info" : "badge-warning"
                      }`}>
                        {post.status === "published" ? "公開済み" :
                         post.status === "scheduled" ? "予約済み" : "下書き"}
                      </span>
                      <span className="badge badge-purple">{post.type}</span>
                      <span className="text-xs text-slate-400">{post.platform}</span>
                    </div>
                    <h4 className="text-sm font-medium text-slate-800">{post.title}</h4>
                    <p className="text-xs text-slate-500 mt-1 line-clamp-2">{post.content}</p>
                  </div>
                  <div className="text-right ml-4">
                    <p className="text-sm font-medium text-slate-600">{post.date.slice(5)}</p>
                    <p className="text-xs text-slate-400">{post.time}</p>
                    <div className="flex gap-1 mt-2">
                      <button className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200">編集</button>
                      <button onClick={() => handleDeletePost(post.id)} className="text-xs px-2 py-1 bg-red-50 text-red-600 rounded hover:bg-red-100">削除</button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 新規投稿モーダル */}
      {showNewPost && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowNewPost(false)}>
          <div className="bg-white rounded-xl p-6 w-[500px] max-h-[80vh] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4">新規投稿を作成</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">タイトル</label>
                <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newPost.title} onChange={(e) => setNewPost({ ...newPost, title: e.target.value })} placeholder="投稿タイトル" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">投稿の種類</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newPost.type} onChange={(e) => setNewPost({ ...newPost, type: e.target.value })}>
                  {postTypes.map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">投稿日</label>
                  <input type="date" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newPost.date} onChange={(e) => setNewPost({ ...newPost, date: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 block mb-1">時間</label>
                  <input type="time" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newPost.time} onChange={(e) => setNewPost({ ...newPost, time: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">プラットフォーム</label>
                <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" value={newPost.platform} onChange={(e) => setNewPost({ ...newPost, platform: e.target.value })}>
                  <option>GBP</option>
                  <option>GBP + Instagram</option>
                  <option>Instagram</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600 block mb-1">本文</label>
                <textarea className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm h-32" value={newPost.content} onChange={(e) => setNewPost({ ...newPost, content: e.target.value })} placeholder="投稿内容を入力..." />
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button onClick={handleAddPost} disabled={!newPost.title || !newPost.date} className="flex-1 bg-[#003D6B] text-white py-2 rounded-lg text-sm font-medium hover:bg-[#002a4a] transition disabled:opacity-50">予約投稿に追加</button>
              <button onClick={() => setShowNewPost(false)} className="px-4 py-2 border border-slate-200 rounded-lg text-sm hover:bg-slate-50">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      {/* All post features */}
      <h3 className="text-sm font-semibold text-slate-500 mb-3 mt-6">最新情報・投稿管理 全機能</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {[
          { icon: "📋", title: "ヒアリングシートの作成", desc: "選択式でトンマナや基礎情報をヒアリングできるアンケートを作成。他媒体の使用許可も一緒にヒアリング。" },
          { icon: "📥", title: "ヒアリングシートの取り込み", desc: "ヒアリング結果を口コミ返信・投稿文章・初期整備に自動反映。" },
          { icon: "📅", title: "投稿の種類の設定", desc: "1ヶ月分の投稿の種類（通常/特典/イベント等）を先に設定。" },
          { icon: "🤖", title: "AI文章自動生成", desc: "投稿種類＋ヒアリング情報＋AIO/LLMO＋MEO＋Chubby独自ルールを参照した文章を自動生成。" },
          { icon: "📝", title: "定型文の自動生成", desc: "投稿種類ごとに3〜5つの定型文を自動生成。お客様が選択するだけ。" },
          { icon: "⏰", title: "予約投稿", desc: "写真と日時を設定したら自動で予約投稿。当日の時間指定にも対応。" },
          { icon: "🕐", title: "当日の予約投稿（時間指定できる）", desc: "投稿作成UIに当日モード追加→時間セレクタで当日の任意時刻を指定" },
          { icon: "🚀", title: "直接投稿", desc: "システム上で設定を完了させたらそのまま直接投稿。" },
          { icon: "🏷️", title: "投稿種類の選択", desc: "イベント/特典/日本語/多言語投稿を簡単に選択。定型文・ボタン・URL設定。" },
          { icon: "🎫", title: "特典投稿のタイトル設定", desc: "ホットペッパーから選択式で投稿タイトルを設定。" },
          { icon: "👁️", title: "最新情報の閲覧数表示", desc: "投稿がどれだけ閲覧されているかを表示。" },
          { icon: "🔗", title: "リンククリック数", desc: "通常投稿・特典投稿のボタンクリック数を投稿ごと/月間/トータルで表示。" },
          { icon: "🌍", title: "投稿文章の翻訳", desc: "確認後に指定言語に翻訳。言語ごとに文字数範囲を指定可能。" },
          { icon: "✏️", title: "誤字脱字修正", desc: "投稿文章の誤字脱字をAIが自動で修正。" },
          { icon: "🔄", title: "重複文章の発見", desc: "過去の投稿と重複する文章がある場合、投稿をブロック＆エラー理由表示。" },
          { icon: "📷", title: "重複写真の発見", desc: "過去の投稿と重複する写真がある場合、投稿をブロック＆重複写真を表示。" },
          { icon: "🎨", title: "使用写真の加工", desc: "明度・彩度をナチュラルかつきれいに自動加工（過度な加工はNG）。" },
          { icon: "⚡", title: "月初全自動記事生成", desc: "月初に各店舗で15〜30の記事を自動生成。写真と日付を選べばその日に更新。" },
          { icon: "✋", title: "月初半自動記事生成", desc: "お客様が気に入った記事に日付と写真を選択すればその日に投稿。" },
          { icon: "📸", title: "予約投稿（写真）", desc: "写真を設定して日時指定で自動投稿。任意枚数を一気にアップロード。" },
          { icon: "📤", title: "直接投稿（写真）", desc: "写真を設定して直接投稿。任意枚数を一気にアップロード。" },
          { icon: "🔧", title: "投稿エラー時の原因特定", desc: "投稿拒否時に文章を1行ずつ検証→URL追加→写真追加の順で原因特定。" },
          { icon: "⏱️", title: "店舗別の最適投稿時間帯分析", desc: "インサイトから最もエンゲージメントが高い曜日・時間帯を自動提案。" },
          { icon: "📆", title: "季節・イベント自動カレンダー", desc: "祝日・季節イベント・業種別繁忙期を自動反映した投稿カレンダー。" },
          { icon: "🎨", title: "AI画像生成", desc: "写真がない場合でもAIでイメージ画像を自動生成して投稿に活用。" },
          { icon: "🚨", title: "ネガティブ口コミ急増アラート", desc: "短期間に低評価口コミが集中した場合、即時通知で炎上リスクを早期検知。" },
          { icon: "☁️", title: "口コミからのキーワード自動抽出", desc: "頻出ワードをワードクラウドで可視化し、対策KWや投稿ネタに活用。" },
          { icon: "🎥", title: "動画投稿", desc: "最新投稿や写真投稿で動画を予約投稿するシステム。" },
          { icon: "📦", title: "一括投稿", desc: "系列で写真や文章を同じもので投稿する際に一括投稿。" },
          { icon: "⚡", title: "記事生成一括処理（全店舗）", desc: "全店舗分の記事を一括生成→予約投稿に追加。AI完結が理想。" },
          { icon: "🔧", title: "ヒアリング情報の簡略化", desc: "他ツール連携で入力を自動化し、ヒアリング作業を最小限に簡略化。" },
        ].map((f, i) => {
          const feature = featureDetails.find((fd) => fd.title === f.title);
          const inner = (
            <div className="p-3 border border-slate-100 rounded-lg bg-white flex items-start gap-3 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer group">
              <span className="text-lg">{f.icon}</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-slate-700">{f.title}</p>
                <p className="text-[10px] text-slate-500 mt-0.5">{f.desc}</p>
              </div>
              <span className="opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded transition whitespace-nowrap">詳細 →</span>
            </div>
          );
          return feature ? (
            <Link key={i} href={`/feature/${feature.slug}/`}>{inner}</Link>
          ) : (
            <div key={i}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
