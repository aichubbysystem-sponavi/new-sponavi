"use client";

import { useMemo, useState } from "react";
import { useGbpAliases } from "@/components/gbp-aliases";
import { buildShopIndex, matchShopNames, type MatchShop, type ShopNameMatchResult } from "@/lib/shop-name-match";

/**
 * 店舗名を複数行で貼り付け → 一致した店舗を自動チェックするUI。
 * 照合ロジックの仕様は @/lib/shop-name-match を参照（部分一致では自動チェックしない）。
 */

// 候補ボタンの表示名。GBPで改名済みなら現在名も併記する
const shopLabel = (s: MatchShop) =>
  s.aliases?.length ? `${s.name}（GBP: ${s.aliases[0]}）` : s.name;

export default function ShopPasteSelector({
  shops,
  selectedIds,
  onChange,
}: {
  shops: MatchShop[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [appendMode, setAppendMode] = useState(false);
  const [result, setResult] = useState<ShopNameMatchResult | null>(null);
  const { aliases, error: aliasError } = useGbpAliases();

  // GBPで改名された店舗は、現場から来る名前(GBP現在名)とDB上の name が違う。
  // 例) name=アイブロウサロンWHITE EYE…高崎店 / GBP現在名=ジェルネイル専門 WHITE NAIL 高崎店
  const shopsWithAliases = useMemo<MatchShop[]>(() => {
    if (!aliases) return shops;
    return shops.map(s => {
      const g = aliases[s.id];
      return g && g !== s.name ? { ...s, aliases: [g] } : s;
    });
  }, [shops, aliases]);

  const index = useMemo(() => buildShopIndex(shopsWithAliases), [shopsWithAliases]);

  const run = (raw: string) => {
    const res = matchShopNames(raw, shopsWithAliases, index);
    const hitIds = res.matched.map(m => m.shop.id);
    onChange(appendMode ? Array.from(new Set(selectedIds.concat(hitIds))) : Array.from(new Set(hitIds)));
    setResult(res);
  };

  // 要確認・未検出の行を手動で1件チェックする
  const addOne = (shop: MatchShop, input: string) => {
    onChange(Array.from(new Set(selectedIds.concat([shop.id]))));
    setResult(prev => prev && ({
      ...prev,
      ambiguous: prev.ambiguous.filter(a => a.input !== input),
      unmatched: prev.unmatched.filter(u => u.input !== input),
      matched: [...prev.matched, { input, shop, matchedBy: "name" as const }],
    }));
  };

  return (
    <div className="border border-slate-200 rounded-lg bg-white p-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-slate-600">店舗名を貼り付けて一括チェック</p>
        <label className="flex items-center gap-1 text-[10px] text-slate-500 cursor-pointer">
          <input type="checkbox" checked={appendMode} onChange={(e) => setAppendMode(e.target.checked)} className="w-3 h-3" />
          既存の選択に追加する
        </label>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          // 複数行の貼り付けはその場で照合（Enterを押さなくてよい）
          const pasted = e.clipboardData.getData("text");
          if (!pasted.includes("\n")) return;
          e.preventDefault();
          setText(pasted);
          run(pasted);
        }}
        onKeyDown={(e) => {
          // Enter=照合実行 / Shift+Enter=改行（貼り付け運用に合わせる）
          if (e.key === "Enter" && !e.shiftKey && !(e.nativeEvent as any).isComposing) {
            e.preventDefault();
            run(text);
          }
        }}
        rows={3}
        placeholder={"店舗名を1行に1件で貼り付け → Enter\n（改行を入れたいときは Shift+Enter）"}
        className="w-full border border-slate-200 rounded-lg px-2.5 py-2 text-xs font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[#003D6B]/20"
      />
      <div className="flex items-center gap-2 mt-1.5">
        <button type="button" onClick={() => run(text)} disabled={!text.trim()}
          className="text-[11px] px-3 py-1 rounded bg-[#003D6B] text-white font-semibold hover:bg-[#002a4a] disabled:opacity-40">
          貼り付けた店舗をチェック
        </button>
        <button type="button" onClick={() => { setText(""); setResult(null); }}
          className="text-[10px] px-2 py-1 rounded border border-slate-200 text-slate-500 hover:bg-slate-50">
          入力クリア
        </button>
        <span className="text-[10px] text-slate-400 ml-auto">選択中 {selectedIds.length}店舗</span>
      </div>
      {aliasError && (
        <p className="text-[10px] text-amber-700 mt-1">
          GBPの現在の店名が取得できませんでした。改名された店舗は旧店名でしか照合できません（ページを再読込してください）
        </p>
      )}

      {result && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-2 text-[11px]">
            <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">
              一致 {result.matched.length}件
            </span>
            {result.matched.some(m => m.matchedBy === "alias") && (
              <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">
                GBP改名 {result.matched.filter(m => m.matchedBy === "alias").length}件
              </span>
            )}
            {result.ambiguous.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold">
                要確認 {result.ambiguous.length}件
              </span>
            )}
            {result.unmatched.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
                未検出 {result.unmatched.length}件
              </span>
            )}
            {result.duplicated.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                重複行 {result.duplicated.length}件（1件として処理）
              </span>
            )}
          </div>

          {result.ambiguous.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-lg p-2">
              <p className="text-[10px] font-semibold text-amber-700 mb-1">同名の店舗が複数あります。どれか選んでください</p>
              {result.ambiguous.map(a => (
                <div key={a.input} className="mb-1.5">
                  <p className="text-[11px] text-slate-700">{a.input}</p>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {a.candidates.map(c => (
                      <button key={c.id} type="button" onClick={() => addOne(c, a.input)}
                        className="text-[10px] px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-800 hover:bg-amber-100">
                        {shopLabel(c)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {result.unmatched.length > 0 && (
            <div className="border border-red-200 bg-red-50 rounded-lg p-2">
              <p className="text-[10px] font-semibold text-red-600 mb-1">
                見つからなかった店舗（チェックは入っていません）
              </p>
              {result.unmatched.map(u => (
                <div key={u.input} className="mb-1.5">
                  <p className="text-[11px] text-slate-700">・{u.input}</p>
                  {u.suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-0.5 pl-3">
                      <span className="text-[10px] text-slate-400">もしかして:</span>
                      {u.suggestions.map(s => (
                        <button key={s.id} type="button" onClick={() => addOne(s, u.input)}
                          className="text-[10px] px-2 py-0.5 rounded bg-white border border-slate-300 text-slate-600 hover:bg-slate-100">
                          {shopLabel(s)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.matched.length > 0 && (
            <details className="text-[11px]">
              <summary className="cursor-pointer text-slate-500">チェックした{result.matched.length}店舗を表示</summary>
              <div className="mt-1 max-h-[120px] overflow-y-auto border border-slate-100 rounded p-1">
                {result.matched.map(m => (
                  <p key={m.shop.id} className="text-[10px] text-slate-600 truncate">
                    ✓ {m.shop.name}
                    {m.matchedBy === "alias" && (
                      // GBPで改名された店舗。一覧には旧店名で並ぶので対応を明示する
                      <span className="text-blue-600">　←「{m.input}」（GBP現在名）</span>
                    )}
                  </p>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
