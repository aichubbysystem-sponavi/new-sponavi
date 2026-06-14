"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Account = {
  customerId: string;
  name: string;
  status: string;
};

export default function PmaxTopPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const router = useRouter();

  useEffect(() => {
    fetch("/api/pmax/accounts")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) {
          setError(data.error);
        } else {
          setAccounts(data.accounts || []);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filtered = accounts.filter(
    (a) =>
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.customerId.includes(search)
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* ヘッダー */}
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-[#003D6B] flex items-center justify-center">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">P-MAX 広告レポート</h1>
            <p className="text-xs text-slate-500">株式会社Chubby</p>
          </div>
        </div>
      </header>

      {/* メインコンテンツ */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-700 mb-2">アカウント選択</h2>
          <p className="text-sm text-slate-500">レポートを表示するアカウントを選択してください</p>
        </div>

        {/* 検索 */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="アカウント名 または ID で検索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md px-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20 focus:border-[#003D6B]"
          />
        </div>

        {/* ローディング */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-[#003D6B] border-t-transparent rounded-full" />
            <span className="ml-3 text-sm text-slate-500">アカウント一覧を取得中...</span>
          </div>
        )}

        {/* エラー */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* アカウント一覧 */}
        {!loading && !error && (
          <div className="grid gap-3">
            {filtered.length === 0 ? (
              <p className="text-sm text-slate-500 py-8 text-center">
                {search ? "該当するアカウントが見つかりません" : "アカウントがありません"}
              </p>
            ) : (
              filtered.map((account) => (
                <button
                  key={account.customerId}
                  onClick={() => router.push(`/pmax/${account.customerId}`)}
                  className="w-full flex items-center justify-between bg-white rounded-lg border border-slate-200 px-5 py-4 hover:border-[#003D6B]/30 hover:shadow-md transition-all text-left group"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center group-hover:bg-[#003D6B]/10 transition-colors">
                      <svg className="w-5 h-5 text-slate-500 group-hover:text-[#003D6B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 group-hover:text-[#003D6B]">{account.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        ID: {account.customerId.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3")}
                      </p>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-slate-300 group-hover:text-[#003D6B] transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              ))
            )}
          </div>
        )}

        {!loading && !error && (
          <p className="text-xs text-slate-400 mt-4 text-right">{filtered.length} / {accounts.length} アカウント</p>
        )}
      </main>
    </div>
  );
}
