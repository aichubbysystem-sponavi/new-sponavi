"use client";

interface MeoScoreProps {
  score: number;
}

export default function MeoScore({ score }: MeoScoreProps) {
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (score / 100) * circumference;
  const color =
    score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100">
      <h3 className="text-sm font-semibold text-slate-500 mb-4">MEOスコア</h3>
      <div className="flex items-center justify-center">
        <div className="relative">
          <svg width="140" height="140" viewBox="0 0 100 100" role="img" aria-label={`MEOスコア: ${score}点`}>
            <circle
              cx="50" cy="50" r="45"
              fill="none"
              stroke="#e2e8f0"
              strokeWidth="8"
            />
            <circle
              cx="50" cy="50" r="45"
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 50 50)"
              className="score-gauge-circle"
              style={{ strokeDashoffset: offset } as React.CSSProperties}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold" style={{ color }}>{score}</span>
            <span className="text-xs text-slate-400">/ 100</span>
          </div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <ScoreBar label="口コミ" value={72} />
        <ScoreBar label="投稿" value={65} />
        <ScoreBar label="基本情報" value={88} />
        <ScoreBar label="写真" value={55} />
        <ScoreBar label="AIO対応" value={40} />
      </div>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 80 ? "bg-emerald-500" : value >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-16">{label}</span>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-xs font-medium text-slate-600 w-8 text-right">{value}</span>
    </div>
  );
}
