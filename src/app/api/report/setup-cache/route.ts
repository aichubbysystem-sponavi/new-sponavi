import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

/**
 * GET /api/report/setup-cache
 * キャッシュ用テーブルを作成（一度だけ実行）
 */
export async function GET() {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const results: string[] = [];

  // report_shop_list テーブル
  try {
    const { error } = await sb.from("report_shop_list").select("id").limit(1);
    if (error && error.message.includes("does not exist")) {
      // テーブルが存在しない → SQL実行
      const { error: sqlErr } = await sb.rpc("exec_sql", {
        sql: `
          CREATE TABLE IF NOT EXISTS report_shop_list (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL DEFAULT '',
            period TEXT NOT NULL DEFAULT '',
            rating REAL NOT NULL DEFAULT 0,
            total_reviews INTEGER NOT NULL DEFAULT 0,
            area TEXT,
            prev_rating REAL,
            prev_total_reviews INTEGER,
            analyzed BOOLEAN DEFAULT FALSE,
            search_total INTEGER,
            prev_search_total INTEGER,
            map_total INTEGER,
            prev_map_total INTEGER,
            action_total INTEGER,
            prev_action_total INTEGER,
            synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          ALTER TABLE report_shop_list ENABLE ROW LEVEL SECURITY;
          CREATE POLICY IF NOT EXISTS "allow_all" ON report_shop_list FOR ALL USING (true) WITH CHECK (true);
        `,
      });
      if (sqlErr) {
        // RPC不available → 直接insertで自動作成を試みる
        results.push(`report_shop_list: RPC unavailable (${sqlErr.message}), trying insert...`);
        const { error: insertErr } = await sb.from("report_shop_list").insert({
          id: "__test__", name: "test", address: "", period: "", rating: 0,
          total_reviews: 0, synced_at: new Date().toISOString(),
        });
        if (insertErr) {
          results.push(`report_shop_list: ${insertErr.message}`);
        } else {
          await sb.from("report_shop_list").delete().eq("id", "__test__");
          results.push("report_shop_list: created via insert");
        }
      } else {
        results.push("report_shop_list: created via SQL");
      }
    } else {
      results.push("report_shop_list: already exists");
    }
  } catch (e: any) {
    results.push(`report_shop_list: error ${e.message}`);
  }

  // report_data_cache テーブル
  try {
    const { error } = await sb.from("report_data_cache").select("shop_name").limit(1);
    if (error && error.message.includes("does not exist")) {
      const { error: sqlErr } = await sb.rpc("exec_sql", {
        sql: `
          CREATE TABLE IF NOT EXISTS report_data_cache (
            shop_name TEXT PRIMARY KEY,
            report_json JSONB NOT NULL,
            synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          ALTER TABLE report_data_cache ENABLE ROW LEVEL SECURITY;
          CREATE POLICY IF NOT EXISTS "allow_all" ON report_data_cache FOR ALL USING (true) WITH CHECK (true);
        `,
      });
      if (sqlErr) {
        results.push(`report_data_cache: RPC unavailable (${sqlErr.message}), trying insert...`);
        const { error: insertErr } = await sb.from("report_data_cache").insert({
          shop_name: "__test__", report_json: {}, synced_at: new Date().toISOString(),
        });
        if (insertErr) {
          results.push(`report_data_cache: ${insertErr.message}`);
        } else {
          await sb.from("report_data_cache").delete().eq("shop_name", "__test__");
          results.push("report_data_cache: created via insert");
        }
      } else {
        results.push("report_data_cache: created via SQL");
      }
    } else {
      results.push("report_data_cache: already exists");
    }
  } catch (e: any) {
    results.push(`report_data_cache: error ${e.message}`);
  }

  return NextResponse.json({ results });
}
