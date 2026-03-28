import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#E6EEFF]" style={{ marginLeft: 0 }}>
      <div className="text-center">
        <h1 className="text-7xl font-bold text-[#003D6B] mb-4">404</h1>
        <h2 className="text-xl font-semibold text-slate-700 mb-2">
          ページが見つかりません
        </h2>
        <p className="text-sm text-slate-500 mb-8">
          お探しのページは移動または削除された可能性があります。
        </p>
        <Link
          href="/"
          className="inline-block bg-[#003D6B] text-white px-6 py-3 rounded-lg font-medium hover:bg-[#002a4a] transition"
        >
          ダッシュボードに戻る
        </Link>
      </div>
    </div>
  );
}
