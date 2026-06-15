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
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });

  const tokenText = await res.text();
  let data: any;
  try { data = JSON.parse(tokenText); } catch { throw new Error(`Token response not JSON: ${tokenText.slice(0, 200)}`); }
  if (!data.access_token) {
    throw new Error(`Failed to get access token: ${tokenText.slice(0, 300)}`);
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  console.log(`[google-ads] token refreshed, len=${data.access_token.length}, expires_in=${data.expires_in}`);
  return data.access_token;
}

/** Google Ads API にGAQLクエリを実行 */
async function executeGaql(customerId: string, query: string): Promise<any[]> {
  const accessToken = await getAccessToken();
  const mccId = process.env.GOOGLE_ADS_MCC_ID!;

  const res = await fetch(
    `${ADS_API_URL}/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
        "login-customer-id": mccId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Google Ads API error (${res.status}): ${errorText}\n[debug] token_len=${accessToken.length}, token_prefix=${accessToken.slice(0, 10)}, mcc=${mccId}, dev_token_len=${(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").length}`);
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
