"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import api from "@/lib/api";

interface TaskItem {
  category: string;
  label: string;
  count: number;
  priority: "high" | "medium" | "low";
}

const CATEGORY_LINKS: Record<string, string> = {
  reviews: "/reviews",
  nap: "/citation",
  posts: "/posts",
};

const PRIORITY_STYLES: Record<string, { dot: string; text: string }> = {
  high: { dot: "bg-red-500", text: "text-red-600" },
  medium: { dot: "bg-amber-500", text: "text-amber-600" },
  low: { dot: "bg-slate-400", text: "text-slate-500" },
};

export default function FloatingTasks() {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/api/report/tasks")
      .then((res) => {
        setTasks(res.data.tasks || []);
        setTotalCount(res.data.totalTasks || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* パネル */}
      {open && (
        <div className="fixed bottom-20 right-6 z-[9998] w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-fade-in">
          <div className="bg-[#003D6B] px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-white font-bold text-sm">AI社長 — タスク一覧</span>
            </div>
            <button onClick={() => setOpen(false)} className="text-white/60 hover:text-white text-lg">✕</button>
          </div>

          <div className="p-4 max-h-[400px] overflow-y-auto">
            {loading ? (
              <p className="text-sm text-slate-400 text-center py-4">読み込み中...</p>
            ) : tasks.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-2xl mb-2">🎉</p>
                <p className="text-sm font-semibold text-emerald-600">タスクはすべて完了！</p>
                <p className="text-xs text-slate-400 mt-1">お疲れ様です</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((task, i) => {
                  const ps = PRIORITY_STYLES[task.priority];
                  const link = CATEGORY_LINKS[task.category];
                  return (
                    <Link key={i} href={link || "/"} onClick={() => setOpen(false)}>
                      <div className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition cursor-pointer border border-slate-100">
                        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${ps.dot}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800">{task.label}</p>
                          <p className={`text-xs ${ps.text}`}>
                            {task.priority === "high" ? "優先度: 高" : task.priority === "medium" ? "優先度: 中" : "優先度: 低"}
                          </p>
                        </div>
                        <span className={`text-lg font-bold ${ps.text}`}>{task.count}</span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="mt-3 pt-3 border-t border-slate-100">
              <Link href="/chatbot" onClick={() => setOpen(false)}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-[#003D6B] hover:bg-[#002a4a] transition"
                style={{ color: "#fff" }}>
                <span className="text-sm font-semibold">AI社長に相談する</span>
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* フローティングボタン */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-[9999] w-14 h-14 rounded-full bg-[#003D6B] hover:bg-[#002a4a] shadow-lg hover:shadow-xl transition-all flex items-center justify-center group"
      >
        <span className="text-white font-bold text-lg group-hover:scale-110 transition-transform">AI</span>
        {totalCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        )}
      </button>
    </>
  );
}
