"use client";

import { useState, useMemo, useCallback } from "react";

interface DateRangePickerProps {
  startMonth: string;  // "2026/1" format
  endMonth: string;    // "2026/5" format
  onChange: (start: string, end: string) => void;
  /** 選択可能な最古の月（デフォルト: 18ヶ月前） */
  minMonth?: string;
  /** 選択可能な最新の月（デフォルト: 今月） */
  maxMonth?: string;
  /** コンパクト表示 */
  compact?: boolean;
}

/** "2026/5" → 202605 の数値変換 */
function monthToNum(m: string): number {
  const p = m.split("/");
  return (parseInt(p[0]) || 0) * 100 + (parseInt(p[1]) || 0);
}

/** 月オプションを生成（降順） */
function generateMonthOptions(min: string, max: string): string[] {
  const opts: string[] = [];
  const [maxY, maxM] = max.split("/").map(Number);
  const [minY, minM] = min.split("/").map(Number);
  let y = maxY, m = maxM;
  while (y * 100 + m >= minY * 100 + minM) {
    opts.push(`${y}/${m}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return opts;
}

/** デフォルトの最小月（18ヶ月前） */
function defaultMinMonth(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 17);
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

/** デフォルトの最大月（今月） */
function defaultMaxMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}`;
}

export default function DateRangePicker({
  startMonth,
  endMonth,
  onChange,
  minMonth,
  maxMonth,
  compact = false,
}: DateRangePickerProps) {
  const min = minMonth || defaultMinMonth();
  const max = maxMonth || defaultMaxMonth();
  const options = useMemo(() => generateMonthOptions(min, max), [min, max]);

  const handleStartChange = useCallback((val: string) => {
    // startがendより後にならないよう制御
    if (monthToNum(val) > monthToNum(endMonth)) {
      onChange(val, val);
    } else {
      onChange(val, endMonth);
    }
  }, [endMonth, onChange]);

  const handleEndChange = useCallback((val: string) => {
    // endがstartより前にならないよう制御
    if (monthToNum(val) < monthToNum(startMonth)) {
      onChange(val, val);
    } else {
      onChange(startMonth, val);
    }
  }, [startMonth, onChange]);

  // プリセットボタン
  const presets = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}/${now.getMonth() + 1}`;
    const prev = (m: number) => {
      const d = new Date(now.getFullYear(), now.getMonth() - m + 1, 1);
      return `${d.getFullYear()}/${d.getMonth() + 1}`;
    };
    return [
      { label: "今月", start: thisMonth, end: thisMonth },
      { label: "先月", start: prev(1), end: prev(1) },
      { label: "3ヶ月", start: prev(3), end: thisMonth },
      { label: "6ヶ月", start: prev(6), end: thisMonth },
      { label: "1年", start: prev(12), end: thisMonth },
      { label: "全期間", start: min, end: thisMonth },
    ].filter(p => monthToNum(p.start) >= monthToNum(min));
  }, [min]);

  const isPresetActive = (p: { start: string; end: string }) =>
    p.start === startMonth && p.end === endMonth;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <select
          value={startMonth}
          onChange={(e) => handleStartChange(e.target.value)}
          className="border rounded px-2 py-1.5 text-slate-700 bg-white"
        >
          {options.map(o => <option key={o} value={o}>{o.replace("/", "年")}月</option>)}
        </select>
        <span className="text-slate-400">〜</span>
        <select
          value={endMonth}
          onChange={(e) => handleEndChange(e.target.value)}
          className="border rounded px-2 py-1.5 text-slate-700 bg-white"
        >
          {options.map(o => <option key={o} value={o}>{o.replace("/", "年")}月</option>)}
        </select>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5">
        <select
          value={startMonth}
          onChange={(e) => handleStartChange(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:ring-2 focus:ring-[#003D6B]/20 focus:border-[#003D6B]"
        >
          {options.map(o => <option key={o} value={o}>{o.replace("/", "年")}月</option>)}
        </select>
        <span className="text-slate-400 text-sm">〜</span>
        <select
          value={endMonth}
          onChange={(e) => handleEndChange(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm text-slate-700 bg-white focus:ring-2 focus:ring-[#003D6B]/20 focus:border-[#003D6B]"
        >
          {options.map(o => <option key={o} value={o}>{o.replace("/", "年")}月</option>)}
        </select>
      </div>
      <div className="flex gap-1">
        {presets.map(p => (
          <button
            key={p.label}
            onClick={() => onChange(p.start, p.end)}
            className={`px-2.5 py-1.5 rounded text-xs font-medium transition ${
              isPresetActive(p)
                ? "bg-[#003D6B] text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 期間フィルタの状態管理hook */
export function useDateRange(defaultMonths: number = 1) {
  const now = new Date();
  const thisMonth = `${now.getFullYear()}/${now.getMonth() + 1}`;
  const startDefault = defaultMonths === 1
    ? thisMonth
    : (() => {
        const d = new Date(now.getFullYear(), now.getMonth() - defaultMonths + 1, 1);
        return `${d.getFullYear()}/${d.getMonth() + 1}`;
      })();

  const [startMonth, setStartMonth] = useState(startDefault);
  const [endMonth, setEndMonth] = useState(thisMonth);

  const setRange = useCallback((start: string, end: string) => {
    setStartMonth(start);
    setEndMonth(end);
  }, []);

  /** 日付文字列が期間内かチェック（ISO形式 "2026-05-15" や "2026/5" に対応） */
  const isInRange = useCallback((dateStr: string): boolean => {
    if (!dateStr) return false;
    // "2026-05-15" or "2026-05-15T..." → "2026/5"
    const d = new Date(dateStr.replace(/\//g, "-"));
    if (isNaN(d.getTime())) return false;
    const m = `${d.getFullYear()}/${d.getMonth() + 1}`;
    return monthToNum(m) >= monthToNum(startMonth) && monthToNum(m) <= monthToNum(endMonth);
  }, [startMonth, endMonth]);

  /** 月文字列が期間内かチェック（"2026/5" 形式） */
  const isMonthInRange = useCallback((month: string): boolean => {
    return monthToNum(month) >= monthToNum(startMonth) && monthToNum(month) <= monthToNum(endMonth);
  }, [startMonth, endMonth]);

  return { startMonth, endMonth, setRange, isInRange, isMonthInRange };
}
