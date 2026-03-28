export default function Loading() {
  return (
    <div className="animate-fade-in">
      {/* Header skeleton */}
      <div className="mb-6">
        <div className="h-7 w-48 bg-slate-200 rounded animate-pulse" />
        <div className="h-4 w-32 bg-slate-100 rounded animate-pulse mt-2" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-white rounded-xl p-5 shadow-sm border border-slate-100">
            <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
            <div className="h-8 w-16 bg-slate-200 rounded animate-pulse mt-2" />
            <div className="h-3 w-24 bg-slate-50 rounded animate-pulse mt-3" />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className="bg-white rounded-xl p-6 shadow-sm border border-slate-100 h-[350px]">
        <div className="h-4 w-32 bg-slate-100 rounded animate-pulse mb-4" />
        <div className="h-full bg-slate-50 rounded animate-pulse" />
      </div>
    </div>
  );
}
