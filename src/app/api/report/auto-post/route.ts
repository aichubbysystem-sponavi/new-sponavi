import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

async function getOAuthToken(): Promise<string | null> {
  const supabase = getSupabase();
  const { data } = await supabase.from("system_oauth_tokens")
    .select("access_token, refresh_token, expiry").limit(1).maybeSingle();
  if (!data) return null;
  if (new Date(data.expiry).getTime() - Date.now() > 5 * 60 * 1000) return data.access_token;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: GBP_CLIENT_ID, client_secret: GBP_CLIENT_SECRET,
        refresh_token: data.refresh_token, grant_type: "refresh_token" }),
    });
    if (!res.ok) return data.access_token;
    const t = await res.json();
    await getSupabase().from("system_oauth_tokens").update({
      access_token: t.access_token,
      expiry: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(),
    }).not("account_id", "is", null);
    return t.access_token;
  } catch { return data.access_token; }
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  while (i < text.length) {
    const row: string[] = [];
    while (i < text.length) {
      if (text[i] === '"') {
        i++; let f = "";
        while (i < text.length) {
          if (text[i] === '"') { if (i + 1 < text.length && text[i + 1] === '"') { f += '"'; i += 2; } else { i++; break; } }
          else { f += text[i]; i++; }
        }
        row.push(f);
        if (i < text.length && text[i] === ",") i++;
      } else {
        let f = "";
        while (i < text.length && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") { f += text[i]; i++; }
        row.push(f);
        if (i < text.length && text[i] === ",") i++; else break;
      }
    }
    while (i < text.length && (text[i] === "\n" || text[i] === "\r")) i++;
    if (row.some((c) => c)) rows.push(row);
  }
  return rows;
}

/**
 * POST /api/report/auto-post
 * スプレッドシートから自動投稿
 * body: { sheetId, targetDate (YYYY-MM-DD), dryRun? }
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });

  const body = await request.json();
  const { sheetId, targetDate, dryRun } = body as {
    sheetId: string;
    targetDate: string; // "2026-04-11"
    dryRun?: boolean;
  };

  if (!sheetId || !targetDate) {
    return NextResponse.json({ error: "sheetIdとtargetDateが必要です" }, { status: 400 });
  }

  // 日付フォーマット変換
  const dateObj = new Date(targetDate);
  const dateCompact = `${dateObj.getFullYear()}${String(dateObj.getMonth() + 1).padStart(2, "0")}${String(dateObj.getDate()).padStart(2, "0")}`;
  const dateSlash = `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
  const dateSlashPad = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

  // 対象タブを読み込み
  const tabs = ["投稿用シート", "報告必須店舗 投稿用シート", "WHITE 系列 投稿用シート"];
  const allMatches: { shopName: string; summary: string; photoUrl: string; tab: string; rawPhotoCell: string; rawDateCell: string }[] = [];

  for (const tab of tabs) {
    try {
      const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
      const res = await fetch(gvizUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        redirect: "follow",
      });
      if (!res.ok) continue;

      const csvText = await res.text();
      if (csvText.includes("<!DOCTYPE") || csvText.includes("<html")) continue;

      const rows = parseCSV(csvText);

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const shopName = (row[1] || "").trim(); // B列（index 1）
        const postText = (row[2] || "").trim(); // C列（index 2）
        const dateCell = (row[4] || "").trim(); // E列（index 4）
        const photoCell = (row[5] || "").trim(); // F列（index 5）

        if (!shopName || !postText) continue;

        // 日付マッチ（複数フォーマット対応）
        const dateMatch = dateCell.includes(dateCompact)
          || dateCell.includes(dateSlash)
          || dateCell.includes(dateSlashPad)
          || dateCell.includes(targetDate);

        if (!dateMatch) continue;

        // F列から写真URLを抽出（日付形式で検索）
        let photoUrl = "";
        if (photoCell) {
          // URLを抽出
          const urls = photoCell.match(/https?:\/\/[^\s,"]+/g) || [];
          // 日付を含むURLを優先
          const dated = urls.find((u) => u.includes(dateCompact));
          photoUrl = dated || urls[0] || photoCell.trim();
          // Dropbox修正
          if (photoUrl.includes("dropbox.com")) photoUrl = photoUrl.replace("dl=0", "raw=1");
        }

        allMatches.push({ shopName, summary: postText, photoUrl, tab, rawPhotoCell: photoCell, rawDateCell: dateCell });
      }
    } catch (e) {
      console.error(`[auto-post] Tab "${tab}" error:`, e);
    }
  }

  if (allMatches.length === 0) {
    return NextResponse.json({ matches: 0, message: `${targetDate}に該当する投稿データがありません`, dateCompact });
  }

  if (dryRun) {
    return NextResponse.json({ matches: allMatches.length, data: allMatches, message: "プレビュー（実際の投稿はしません）" });
  }

  // GBP投稿実行
  const accessToken = await getOAuthToken();
  if (!accessToken) return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });

  const supabase = getSupabase();
  const { data: shops } = await supabase.from("shops")
    .select("id, name, gbp_location_name, gbp_shop_name")
    .not("gbp_location_name", "is", null);

  let posted = 0;
  let errors = 0;
  const results: any[] = [];

  for (const match of allMatches) {
    // 店舗名でマッチ
    const shop = (shops || []).find((s) =>
      s.name === match.shopName || s.gbp_shop_name === match.shopName
      || s.name.includes(match.shopName) || match.shopName.includes(s.name)
    );

    if (!shop) {
      results.push({ shopName: match.shopName, status: "店舗未登録", summary: match.summary.slice(0, 30) });
      errors++;
      continue;
    }

    const locationName = shop.gbp_location_name.startsWith("accounts/")
      ? shop.gbp_location_name
      : `accounts/111148362910776147900/${shop.gbp_location_name}`;

    const postBody: any = { summary: match.summary, topicType: "STANDARD", languageCode: "ja" };
    if (match.photoUrl) {
      postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: match.photoUrl }];
    }

    try {
      const res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(postBody),
      });

      if (res.ok) {
        const result = await res.json();
        // post_logsに記録
        await supabase.from("post_logs").insert({
          id: crypto.randomUUID(), shop_id: shop.id, shop_name: shop.name,
          summary: match.summary, topic_type: "STANDARD",
          media_url: match.photoUrl || null, search_url: result.searchUrl || null,
        });
        results.push({ shopName: match.shopName, status: "投稿成功", summary: match.summary.slice(0, 30) });
        posted++;
      } else {
        const err = await res.text().catch(() => "");
        results.push({ shopName: match.shopName, status: `エラー(${res.status})`, summary: match.summary.slice(0, 30) });
        errors++;
      }
    } catch (e: any) {
      results.push({ shopName: match.shopName, status: `エラー: ${e?.message}`, summary: match.summary.slice(0, 30) });
      errors++;
    }
  }

  return NextResponse.json({ matches: allMatches.length, posted, errors, results });
}
