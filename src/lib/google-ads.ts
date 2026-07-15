/**
 * Google Ads API ヘルパー
 * Google Ads API v20 (REST) を使用してレポートデータを取得
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ADS_API_URL = "https://googleads.googleapis.com/v23";

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/** アクセストークンを取得（キャッシュ付き） */
async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAt - 60000) {
    return cachedAccessToken.token;
  }

  const res = await fetch(TOKEN_URL, {
    cache: "no-store" as const,
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Failed to get access token: ${JSON.stringify(data)}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return data.access_token;
}

/** Google Ads API にGAQLクエリを実行 */
async function executeGaql(customerId: string, query: string): Promise<any[]> {
  const accessToken = await getAccessToken();
  const mccId = process.env.GOOGLE_ADS_MCC_ID!;

  const res = await fetch(
    `${ADS_API_URL}/customers/${customerId}/googleAds:search`,
    {
      cache: "no-store" as const,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Ads API error (${res.status}): ${errorText}`);
  }

  const data = await res.json();
  return data.results || [];
}

/** MCC配下の全アカウント（クライアント）を取得 */
export async function listAccounts(): Promise<
  { customerId: string; name: string; status: string }[]
> {
  const mccId = process.env.GOOGLE_ADS_MCC_ID!;
  const query = `
    SELECT
      customer_client.client_customer,
      customer_client.descriptive_name,
      customer_client.status,
      customer_client.manager,
      customer_client.level
    FROM customer_client
    WHERE customer_client.manager = false
      AND customer_client.status = 'ENABLED'
      AND customer_client.level = 1
  `;

  const results = await executeGaql(mccId, query);
  return results.map((r: any) => ({
    customerId: r.customerClient.clientCustomer.replace("customers/", ""),
    name: r.customerClient.descriptiveName || "",
    status: r.customerClient.status || "",
  }));
}

/** アカウントのサマリー指標を取得（指定期間） */
export async function getAccountSummary(
  customerId: string,
  startDate: string,
  endDate: string
): Promise<{
  impressions: number;
  clicks: number;
  costMicros: number;
  conversions: number;
  interactionRate: number;
}> {
  const query = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.interaction_rate
    FROM customer
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
  `;

  const results = await executeGaql(customerId, query);

  let impressions = 0;
  let clicks = 0;
  let costMicros = 0;
  let conversions = 0;

  for (const r of results) {
    impressions += Number(r.metrics?.impressions || 0);
    clicks += Number(r.metrics?.clicks || 0);
    costMicros += Number(r.metrics?.costMicros || 0);
    conversions += Number(r.metrics?.conversions || 0);
  }

  return {
    impressions,
    clicks,
    costMicros,
    conversions,
    interactionRate: impressions > 0 ? clicks / impressions : 0,
  };
}

// ── キャンペーン名パーサー ──

const KNOWN_LANGUAGES = ["Japanese", "Chinese", "English", "Korean", "Thai", "Vietnamese", "French", "Spanish", "Portuguese", "German", "Italian", "Russian", "Arabic", "Hindi"];

/**
 * キャンペーン名から店舗名と言語を抽出
 *
 * 対応パターン:
 * - "P-MAX ACE COLOR 那覇小禄イオン店 Japanese" → { shopName: "ACE COLOR 那覇小禄イオン店", language: "Japanese" }
 * - "来店CV用 とりとん 大久保店" → { shopName: "とりとん 大久保店", language: "Japanese" }
 * - "来店CV用７ 海老元" → { shopName: "海老元", language: "Japanese" }
 * - パターン不一致 → campaignName をそのまま shopName に、language は "Unknown"
 */
export function parseCampaignName(campaignName: string): { shopName: string; language: string } {
  let name = campaignName;

  // "P-MAX " プレフィックスを除去
  if (name.startsWith("P-MAX ")) {
    name = name.slice(6);
  }

  // "来店CV用" 系プレフィックスを除去（来店CV用、来店CV用１〜９等）
  // これらは言語サフィックスがなく、日本語キャンペーン
  const raitenMatch = name.match(/^来店CV用[０-９0-9]?\s+/);
  if (raitenMatch) {
    const shopName = name.slice(raitenMatch[0].length).trim();
    return { shopName: shopName || name.trim(), language: "Japanese" };
  }

  // 末尾の単語が言語かチェック
  const lastSpace = name.lastIndexOf(" ");
  if (lastSpace > 0) {
    const lastWord = name.slice(lastSpace + 1);
    if (KNOWN_LANGUAGES.includes(lastWord)) {
      return { shopName: name.slice(0, lastSpace).trim(), language: lastWord };
    }
  }

  // パターンに合わない場合
  return { shopName: name.trim(), language: "Unknown" };
}

export interface StoreSummary {
  shopName: string;
  languages: string[];
  impressions: number;
  clicks: number;
  costMicros: number;
  /** このストアのキャンペーンが属するアカウントID群 */
  accountIds: string[];
}

/**
 * 全アカウント横断で店舗別サマリーを取得
 * 各アカウントのキャンペーン月次データを取得→店舗名でグループ化
 */
export async function getStoreSummaries(
  startDate: string,
  endDate: string
): Promise<StoreSummary[]> {
  const accounts = await listAccounts();

  // 10並列でキャンペーンデータ取得
  const BATCH = 10;
  const allCampaigns: { accountId: string; campaignName: string; impressions: number; clicks: number; costMicros: number }[] = [];

  for (let i = 0; i < accounts.length; i += BATCH) {
    const batch = accounts.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (a) => {
        try {
          const data = await getCampaignMonthly(a.customerId, startDate, endDate);
          return data.map((d) => ({ accountId: a.customerId, ...d }));
        } catch {
          return [];
        }
      })
    );
    for (const r of results) {
      if (r.status === "fulfilled") {
        allCampaigns.push(...r.value.map((c) => ({
          accountId: c.accountId,
          campaignName: c.campaignName,
          impressions: c.impressions,
          clicks: c.clicks,
          costMicros: c.costMicros,
        })));
      }
    }
  }

  // 店舗名でグループ化
  const storeMap = new Map<string, { languages: Set<string>; impressions: number; clicks: number; costMicros: number; accountIds: Set<string> }>();

  for (const c of allCampaigns) {
    const { shopName, language } = parseCampaignName(c.campaignName);
    const existing = storeMap.get(shopName);
    if (existing) {
      existing.languages.add(language);
      existing.impressions += c.impressions;
      existing.clicks += c.clicks;
      existing.costMicros += c.costMicros;
      existing.accountIds.add(c.accountId);
    } else {
      storeMap.set(shopName, {
        languages: new Set([language]),
        impressions: c.impressions,
        clicks: c.clicks,
        costMicros: c.costMicros,
        accountIds: new Set([c.accountId]),
      });
    }
  }

  return Array.from(storeMap.entries())
    .map(([shopName, v]) => ({
      shopName,
      languages: Array.from(v.languages).sort(),
      impressions: v.impressions,
      clicks: v.clicks,
      costMicros: v.costMicros,
      accountIds: Array.from(v.accountIds),
    }))
    .sort((a, b) => b.impressions - a.impressions);
}

export interface StoreDetailCampaign {
  language: string;
  campaignName: string;
  campaignId: string;
  month?: string;
  date?: string;
  impressions: number;
  clicks: number;
  ctr: number;
  averageCpc: number;
  costMicros: number;
}

/**
 * 特定店舗のキャンペーン（言語別）月次・日次データを取得
 */
export async function getStoreDetail(
  shopName: string,
  startDate: string,
  endDate: string,
  knownAccountIds?: string[],
  dailyStartDate?: string,
  dailyEndDate?: string,
): Promise<{ monthly: StoreDetailCampaign[]; daily: StoreDetailCampaign[] }> {
  // knownAccountIdsがあればそのアカウントのみ検索（高速化）
  let targetIds = knownAccountIds;
  if (!targetIds || targetIds.length === 0) {
    const accounts = await listAccounts();
    targetIds = accounts.map(a => a.customerId);
  }

  // 日次は別の日付範囲（指定がなければ月次と同じ）
  const dStart = dailyStartDate || startDate;
  const dEnd = dailyEndDate || endDate;

  const monthly: StoreDetailCampaign[] = [];
  const daily: StoreDetailCampaign[] = [];

  // 10並列でアカウントから取得
  const BATCH = 10;
  for (let i = 0; i < targetIds.length; i += BATCH) {
    const batch = targetIds.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(async (customerId) => {
        const [m, d] = await Promise.all([
          getCampaignMonthly(customerId, startDate, endDate).catch(() => []),
          getCampaignDaily(customerId, dStart, dEnd).catch(() => []),
        ]);
        return { monthly: m, daily: d };
      })
    );
    for (const r of results) {
      if (r.status !== "fulfilled") continue;
      for (const c of r.value.monthly) {
        const parsed = parseCampaignName(c.campaignName);
        if (parsed.shopName === shopName) {
          monthly.push({ language: parsed.language, ...c });
        }
      }
      for (const c of r.value.daily) {
        const parsed = parseCampaignName(c.campaignName);
        if (parsed.shopName === shopName) {
          daily.push({ language: parsed.language, ...c });
        }
      }
    }
  }

  return { monthly, daily };
}

/** キャンペーン別の月次データ（12ヶ月分） */
export async function getCampaignMonthly(
  customerId: string,
  startDate: string,
  endDate: string
): Promise<
  {
    campaignName: string;
    campaignId: string;
    month: string;
    impressions: number;
    clicks: number;
    ctr: number;
    averageCpc: number;
    costMicros: number;
  }[]
> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.month,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
    ORDER BY segments.month ASC, campaign.name ASC
  `;

  const results = await executeGaql(customerId, query);

  return results.map((r: any) => ({
    campaignName: r.campaign?.name || "",
    campaignId: String(r.campaign?.id || ""),
    month: r.segments?.month || "",
    impressions: Number(r.metrics?.impressions || 0),
    clicks: Number(r.metrics?.clicks || 0),
    ctr: Number(r.metrics?.ctr || 0),
    averageCpc: Number(r.metrics?.averageCpc || 0),
    costMicros: Number(r.metrics?.costMicros || 0),
  }));
}

/**
 * キャンペーン別・広告ネットワーク別データ（媒体別配信内訳用）
 * segments.ad_network_type はP-MAXでもv23からチャネル別に返る
 * （MAPS / SEARCH / YOUTUBE / GMAIL / DISCOVER / CONTENT / SEARCH_PARTNERS 等。
 *   チャネル別データは2025-06-01以降の日付のみ集計される）
 */
export async function getCampaignChannelMonthly(
  customerId: string,
  startDate: string,
  endDate: string
): Promise<
  {
    campaignName: string;
    campaignId: string;
    network: string;
    impressions: number;
    clicks: number;
    costMicros: number;
  }[]
> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.ad_network_type,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
  `;

  const results = await executeGaql(customerId, query);

  return results.map((r: any) => ({
    campaignName: r.campaign?.name || "",
    campaignId: String(r.campaign?.id || ""),
    network: r.segments?.adNetworkType || "UNKNOWN",
    impressions: Number(r.metrics?.impressions || 0),
    clicks: Number(r.metrics?.clicks || 0),
    costMicros: Number(r.metrics?.costMicros || 0),
  }));
}

/** キャンペーン別の日次データ */
export async function getCampaignDaily(
  customerId: string,
  startDate: string,
  endDate: string
): Promise<
  {
    campaignName: string;
    campaignId: string;
    date: string;
    impressions: number;
    clicks: number;
    ctr: number;
    averageCpc: number;
    costMicros: number;
  }[]
> {
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros
    FROM campaign
    WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.status != 'REMOVED'
    ORDER BY segments.date ASC, campaign.name ASC
  `;

  const results = await executeGaql(customerId, query);

  return results.map((r: any) => ({
    campaignName: r.campaign?.name || "",
    campaignId: String(r.campaign?.id || ""),
    date: r.segments?.date || "",
    impressions: Number(r.metrics?.impressions || 0),
    clicks: Number(r.metrics?.clicks || 0),
    ctr: Number(r.metrics?.ctr || 0),
    averageCpc: Number(r.metrics?.averageCpc || 0),
    costMicros: Number(r.metrics?.costMicros || 0),
  }));
}
