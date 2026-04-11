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

const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || "";
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || "";
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || "";

let cachedDropboxToken: { token: string; expires: number } | null = null;

async function getDropboxAccessToken(): Promise<string | null> {
  if (cachedDropboxToken && cachedDropboxToken.expires > Date.now()) return cachedDropboxToken.token;
  if (!DROPBOX_APP_KEY || !DROPBOX_REFRESH_TOKEN) return null;

  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: DROPBOX_REFRESH_TOKEN,
        client_id: DROPBOX_APP_KEY,
        client_secret: DROPBOX_APP_SECRET,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    cachedDropboxToken = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch { return null; }
}

/**
 * Dropboxフォルダ内を日付で検索し、一致するファイルの一時DLリンクを取得
 */
async function searchDropboxPhoto(folderUrl: string, dateCompact: string, shopName: string): Promise<string> {
  console.log(`[dropbox-search] folder=${folderUrl.slice(0, 60)}, date=${dateCompact}, shop=${shopName}`);
  const dbxToken = await getDropboxAccessToken();
  if (!dbxToken) return "";

  // フォルダURLからパスを推定（/MEO対策　定期更新用写真/{店舗名}）
  // もしくはshared linkのメタデータから取得
  let searchPath = "";

  // URLからフォルダ名を抽出してパスを構築
  try {
    // まずshared linkからパスを取得
    const metaRes = await fetch("https://api.dropboxapi.com/2/sharing/get_shared_link_metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
      body: JSON.stringify({ url: folderUrl.split("?")[0] + "?dl=0" }),
    });
    if (metaRes.ok) {
      const meta = await metaRes.json();
      searchPath = meta.path_lower || meta.path_display || "";
      console.log(`[dropbox-search] shared link path: ${searchPath}`);
    } else {
      const errText = await metaRes.text().catch(() => "");
      console.log(`[dropbox-search] shared link error: ${metaRes.status} ${errText.slice(0, 100)}`);
    }
  } catch (e: any) {
    console.log(`[dropbox-search] shared link exception: ${e?.message}`);
  }

  // パスが取れなかった場合、店舗名から推定
  if (!searchPath) {
    searchPath = `/meo対策　定期更新用写真/${shopName}`;
  }

  // Dropbox検索API
  try {
    const searchRes = await fetch("https://api.dropboxapi.com/2/files/search_v2", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
      body: JSON.stringify({
        query: dateCompact,
        options: {
          path: searchPath,
          max_results: 5,
          file_extensions: ["jpg", "jpeg", "png", "gif", "webp"],
        },
      }),
    });

    if (!searchRes.ok) {
      const errText = await searchRes.text().catch(() => "");
      console.log(`[dropbox-search] search error: ${searchRes.status} ${errText.slice(0, 100)}`);
      return "";
    }
    const searchData = await searchRes.json();
    const matches = searchData.matches || [];
    console.log(`[dropbox-search] found ${matches.length} matches for "${dateCompact}" in ${searchPath}`);

    if (matches.length === 0) return "";

    // 最初にマッチしたファイルの一時リンクを取得
    const filePath = matches[0].metadata?.metadata?.path_display || matches[0].metadata?.metadata?.path_lower;
    if (!filePath) return "";

    const linkRes = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
      body: JSON.stringify({ path: filePath }),
    });

    if (!linkRes.ok) return "";
    const linkData = await linkRes.json();
    return linkData.link || "";
  } catch { return ""; }
}

function convertDropboxUrl(url: string): string {
  if (!url || !url.includes("dropbox.com")) return url;
  let direct = url.replace("www.dropbox.com", "dl.dropboxusercontent.com");
  direct = direct.replace(/[&?]dl=\d/g, "").replace(/[&?]st=[^&]*/g, "").replace(/[?&]$/, "");
  return direct;
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
  const allMatches: { shopName: string; summary: string; photoUrl: string; tab: string; rawPhotoCell: string; rawDateCell: string; photoDebug: string }[] = [];

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

        // F列のDropboxフォルダURLから日付で写真を検索
        let photoUrl = "";
        if (photoCell) {
          // Dropboxフォルダの場合: API経由で日付検索
          if (photoCell.includes("dropbox.com")) {
            photoUrl = await searchDropboxPhoto(photoCell.trim(), dateCompact, shopName);
          }
          // 直接URLの場合: 従来のロジック
          if (!photoUrl) {
            const urls = photoCell.match(/https?:\/\/[^\s,"]+/g) || [];
            const dated = urls.find((u) => u.includes(dateCompact));
            photoUrl = dated || "";
            if (photoUrl) photoUrl = convertDropboxUrl(photoUrl);
          }
        }

        allMatches.push({ shopName, summary: postText, photoUrl, tab, rawPhotoCell: photoCell, rawDateCell: dateCell, photoDebug: photoUrl ? "写真取得成功" : (photoCell ? "Dropbox検索で写真が見つかりません" : "F列が空") });
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

    // 本文を1500文字に制限
    const trimmedSummary = match.summary.slice(0, 1500);
    const postBody: any = { summary: trimmedSummary, topicType: "STANDARD", languageCode: "ja" };
    if (match.photoUrl) {
      // Dropbox一時リンクはそのまま使用、それ以外はURL変換
      const directUrl = match.photoUrl.includes("dropboxusercontent.com") || match.photoUrl.includes("dl.dropbox")
        ? match.photoUrl
        : convertDropboxUrl(match.photoUrl);
      postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: directUrl }];
    }

    try {
      let res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(postBody),
      });

      // 写真付きで失敗したら写真なしでリトライ
      if (!res.ok && match.photoUrl) {
        const retryBody = { summary: trimmedSummary, topicType: "STANDARD", languageCode: "ja" };
        res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(retryBody),
        });
      }

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
        results.push({ shopName: match.shopName, status: `エラー(${res.status})`, detail: err.slice(0, 200), summary: match.summary.slice(0, 30), photoUrl: match.photoUrl });
        errors++;
      }
    } catch (e: any) {
      results.push({ shopName: match.shopName, status: `エラー: ${e?.message}`, summary: match.summary.slice(0, 30) });
      errors++;
    }
  }

  return NextResponse.json({ matches: allMatches.length, posted, errors, results });
}
