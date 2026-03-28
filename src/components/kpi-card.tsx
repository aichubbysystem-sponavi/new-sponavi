"use client";

import { cn } from "@/lib/cn";

interface KpiCardProps {
  label: string;
  value: number | string;
  change?: number;
  icon?: string;
  format?: "number" | "percent";
}

export default function KpiCard({ label, value, change, icon, format = "number" }: KpiCardProps) {
  const displayValue =
    format === "number" && typeof value === "number"
      ? value.toLocaleString()
      : value;

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 card-hover">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold mt-1 text-slate-800">{displayValue}</p>
        </div>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      {change !== undefined && (
        <div className="mt-3 flex items-center gap-1">
          <span
            className={cn(
              "text-xs font-semibold px-2 py-0.5 rounded-full",
              change >= 0 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
            )}
          >
            {change >= 0 ? "↑" : "↓"} {Math.abs(change)}%
          </span>
          <span className="text-xs text-slate-400">前月比</span>
        </div>
      )}
    </div>
  );
}
