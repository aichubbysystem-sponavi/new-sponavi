import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";
const GO_API_URL = process.env.NEXT_PUBLIC_API_URL || "";

export async function GET(request: NextRequest) {
  const results: any = {
    timestamp: new Date().toISOString(),
    steps: [],
  };

  // Step 1: 環境変数チェック
  results.env = {
    SUPABASE_URL: !!SUPABASE_URL,
    SUPABASE_SERVICE_KEY: !!SUPABASE_SERVICE_KEY,
    SUPABASE_ANON_KEY: !!SUPABASE_ANON_KEY,
    GBP_CLIENT_ID: !!GBP_CLIENT_ID,
    GBP_CLIENT_SECRET: !!GBP_CLIENT_SECRET,
    SUPABASE_DB_PASSWORD: !!process.env.SUPABASE_DB_PASSWORD,
    GO_API_URL: GO_API_URL || "未設定",
  };

  // Step 2: PostgreSQL直接接続テスト
  const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || "";
  const PROJECT_ID = (SUPABASE_URL.match(/https:\/\/([^.]+)/) || [])[1] || "";
  let tokenFromPg: any = null;

  if (DB_PASSWORD && PROJECT_ID) {
    try {
      const { Client } = await import("pg");
      const client = new Client({
        host: `db.${PROJECT_ID}.supabase.co`, port: 5432,
        database: "postgres", user: "postgres", password: DB_PASSWORD,
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
      });
      await client.connect();
      const result = await client.query(
        "SELECT account_id, length(access_token) as token_len, length(refresh_token) as refresh_len, expiry FROM system.tokens ORDER BY expiry DESC"
      );
      await client.end();
      results.steps.push({ step: "PostgreSQL直接", status: "OK", rows: result.rows.map((r: any) => ({
        account_id: r.account_id,
        token_len: r.token_len,
        refresh_len: r.refresh_len,
        expiry: r.expiry,
        remaining_min: Math.round((new Date(r.expiry).getTime() - Date.now()) / 60000),
      }))});
      if (result.rows.length > 0) tokenFromPg = result.rows[0];
    } catch (e: any) {
      results.steps.push({ step: "PostgreSQL直接", status: "FAIL", error: e?.message });
    }
  } else {
    results.steps.push({ step: "PostgreSQL直接", status: "SKIP", reason: "DB_PASSWORD or PROJECT_ID missing" });
  }

  // Step 3: Supabaseビュー経由テスト
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
    const { data, error } = await supabase.from("system_oauth_tokens")
      .select("access_token, refresh_token, expiry").limit(5);
    if (error) {
      results.steps.push({ step: "Supabaseビュー", status: "FAIL", error: error.message });
    } else {
      results.steps.push({ step: "Supabaseビュー", status: "OK", rows: (data || []).map((r: any) => ({
        token_len: r.access_token?.length || 0,
        refresh_len: r.refresh_token?.length || 0,
        expiry: r.expiry,
        remaining_min: Math.round((new Date(r.expiry).getTime() - Date.now()) / 60000),
      }))});
    }
  } catch (e: any) {
    results.steps.push({ step: "Supabaseビュー", status: "FAIL", error: e?.message });
  }

  // Step 4: Go API テスト
  try {
    const res = await fetch(`${GO_API_URL}/api/gbp/account`, { signal: AbortSignal.timeout(20000) });
    const text = await res.text().catch(() => "");
    results.steps.push({ step: "Go API", status: res.ok ? "OK" : `HTTP ${res.status}`, bodyPreview: text.slice(0, 200) });
  } catch (e: any) {
    results.steps.push({ step: "Go API", status: "FAIL", error: e?.message });
  }

  // Step 5: トークンリフレッシュテスト（期限切れの場合）
  if (tokenFromPg?.account_id) {
    try {
      // DBからrefresh_tokenを取得
      const { Client } = await import("pg");
      const client = new Client({
        host: `db.${PROJECT_ID}.supabase.co`, port: 5432,
        database: "postgres", user: "postgres", password: DB_PASSWORD,
        ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
      });
      await client.connect();
      const rtResult = await client.query(
        "SELECT refresh_token FROM system.tokens WHERE account_id = $1", [tokenFromPg.account_id]
      );
      await client.end();

      const refreshToken = rtResult.rows[0]?.refresh_token;
      if (refreshToken && GBP_CLIENT_ID && GBP_CLIENT_SECRET) {
        const res = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
            refresh_token: refreshToken, grant_type: "refresh_token",
          }),
          signal: AbortSignal.timeout(10000),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.access_token) {
          results.steps.push({ step: "トークンリフレッシュ", status: "OK", expires_in: data.expires_in });

          // Step 6: リフレッシュしたトークンでGBP APIテスト
          const testRes = await fetch("https://mybusinessbusinessinformation.googleapis.com/v1/categories?regionCode=JP&languageCode=ja&view=BASIC&pageSize=1", {
            headers: { Authorization: `Bearer ${data.access_token}` },
            signal: AbortSignal.timeout(10000),
          });
          results.steps.push({ step: "GBP APIテスト(リフレッシュ後)", status: testRes.ok ? "OK" : `HTTP ${testRes.status}` });

          // Step 7: DB書き戻しテスト
          try {
            const client2 = new Client({
              host: `db.${PROJECT_ID}.supabase.co`, port: 5432,
              database: "postgres", user: "postgres", password: DB_PASSWORD,
              ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000,
            });
            await client2.connect();
            const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
            const updateResult = await client2.query(
              "UPDATE system.tokens SET access_token = $1, expiry = $2 WHERE account_id = $3",
              [data.access_token, newExpiry, tokenFromPg.account_id]
            );
            await client2.end();
            results.steps.push({ step: "DB書き戻し", status: "OK", rowsUpdated: updateResult.rowCount });
          } catch (e: any) {
            results.steps.push({ step: "DB書き戻し", status: "FAIL", error: e?.message });
          }
        } else {
          results.steps.push({ step: "トークンリフレッシュ", status: `FAIL HTTP ${res.status}`, error: JSON.stringify(data).slice(0, 200) });
        }
      } else {
        results.steps.push({ step: "トークンリフレッシュ", status: "SKIP", reason: "refresh_token or credentials missing" });
      }
    } catch (e: any) {
      results.steps.push({ step: "トークンリフレッシュ", status: "FAIL", error: e?.message });
    }
  }

  return NextResponse.json(results, { status: 200 });
}
