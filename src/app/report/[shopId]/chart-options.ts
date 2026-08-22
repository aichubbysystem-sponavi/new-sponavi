/**
 * Chart.js / react-chartjs-2 のオプション定義
 * client.tsxから分離して再利用・テスト可能にする
 */

export function buildStackedOptions() {
  return {
    // maintainAspectRatio:false — グラフは「AI総評と表を置いた残り」の高さに収まる。
    // 縦横比を保つと横幅からグラフ高が決まり、総評が長い月にスライドから溢れて
    // 文末が切れていた（2026-08-22）。高さの主導権を総評側に渡している
    responsive: true, maintainAspectRatio: false,
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
  // maintainAspectRatio:false の理由は buildStackedOptions と同じ（総評の場所を優先）
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { display: false } },
    // 目盛りを絞らないとデータ最小値起点の半端な刻み（46,53,60,…,228 の7刻み）になり読みにくい。
    // 本数を制限するとChart.jsがキリのよい刻み（50,100,150…）を選ぶ
    y: {
      beginAtZero: false,
      grid: { color: "#f0f0f0" },
      ticks: { maxTicksLimit: 6, callback: (v: string | number) => Number(v).toLocaleString() },
    },
  },
};
