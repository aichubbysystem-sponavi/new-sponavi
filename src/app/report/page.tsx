import { getShopList } from "@/lib/report-api";
import { createClient } from "@supabase/supabase-js";
import ReportListClient from "./report-list-client";

export const revalidate = 3600; // 1時間キャッシュ（反映ボタンで即時更新）

const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5555";

async function getAnalyzedShops(): Promise<Set<string>> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new Set();

  try {
    const supabase = createClient(url, key);
    const { data } = await supabase.from("report_analysis").select("shop_name");
    return new Set((data || []).map((r: { shop_name: string }) => r.shop_name));
  } catch {
    return new Set();
  }
}

/** GBPアカウント一覧を取得し、ロケーション→アカウント名のマップを返す */
async function getGbpAccountMap(): Promise<{ locToAccount: Map<string, string>; accountNames: string[] }> {
  const locToAccount = new Map<string, string>();
  const accountNames: string[] = [];
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(15000) });
    if (res.ok) {
      const accounts = await res.json();
      for (const acc of (Array.isArray(accounts) ? accounts : [])) {
        const label = acc.email || acc.accountName || acc.name || "";
        if (label) accountNames.push(label);
        for (const loc of (acc.locations || [])) {
          const locName = loc.name || "";
          if (locName) locToAccount.set(locName, label);
          const fullPath = `${acc.name || ""}/${locName}`;
          if (fullPath) locToAccount.set(fullPath, label);
          if (loc.title) locToAccount.set(loc.title, label);
        }
      }
    }
  } catch {}
  return { locToAccount, accountNames };
}

export default async function ReportListPage() {
  const [{ shops, source }, analyzedSet, { locToAccount, accountNames }] = await Promise.all([
    getShopList(),
    getAnalyzedShops(),
    getGbpAccountMap(),
  ]);

  // 分析ステータス + GBPアカウント名をマージ
  const shopsWithStatus = shops.map((s) => ({
    ...s,
    analyzed: analyzedSet.has(s.name),
    gbpAccountLabel: locToAccount.get(s.name) || "",
  }));

  return <ReportListClient shops={shopsWithStatus} source={source} gbpAccountNames={accountNames} />;
}
