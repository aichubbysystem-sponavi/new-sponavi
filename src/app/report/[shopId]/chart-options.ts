/**
 * Chart.js / react-chartjs-2 のオプション定義
 * client.tsxから分離して再利用・テスト可能にする
 */

export function buildStackedOptions() {
  return {
    responsive: true, maintainAspectRatio: true, aspectRatio: 2.2,
    plugins: {
      title: { display: false },
      legend: { position: "top" as const, labels: { font: { family: "Noto Sans JP", size: 11 } } },
      tooltip: { mode: "index" as const, intersect: false, callbacks: {
        afterBody: (items: { parsed: { y: number | null } }[]) => { let t = 0; items.forEach((i) => (t += i.parsed.y ?? 0)); return "合計: " + t.toLocaleString(); },
      }},
    },
    scales: {
      x: { stacked: true, grid: { display: false } },
      y: { stacked: true, beginAtZero: true, grid: { color: "#f0f0f0" }, ticks: { callback: (v: string | number) => Number(v).toLocaleString() } },
    },
  };
}

export const lineOptions = {
  responsive: true, maintainAspectRatio: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false } },
    y: { beginAtZero: false, grid: { color: "#f0f0f0" }, ticks: { callback: (v: string | number) => Number(v).toLocaleString() } },
  },
};
