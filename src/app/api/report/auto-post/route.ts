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
      signal: AbortSignal.timeout(10000),
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
 * Dropbox共有リンクからフォルダ内のファイルをリストし、日付マッチする全写真のDLリンクを取得
 */
async function searchDropboxPhotosMultiple(folderUrl: string, dateCompact: string, shopName: string): Promise<{ urls: string[]; debug: string }> {
  const dbxToken = await getDropboxAccessToken();
  if (!dbxToken) return { urls: [], debug: "Dropboxトークン取得失敗" };

  try {
    // 共有リンクURL正規化（rlkeyパラメータ保持）
    let shareUrl = folderUrl.trim();
    // dl=0/1を除去
    shareUrl = shareUrl.replace(/[&?]dl=\d/, "");

    let files: { name: string; path: string }[] = [];

    // 方法1: get_shared_link_metadata でフォルダパスを取得 → list_folder
    try {
      const metaRes = await fetch("https://api.dropboxapi.com/2/sharing/get_shared_link_metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
        body: JSON.stringify({ url: shareUrl }),
        signal: AbortSignal.timeout(15000),
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        const folderPath = meta.path_lower || meta.path_display || "";
        if (folderPath && meta[".tag"] === "folder") {
          const listRes = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ path: folderPath, limit: 200 }),
            signal: AbortSignal.timeout(15000),
          });
          if (listRes.ok) {
            const listData = await listRes.json();
            files = (listData.entries || [])
              .filter((e: any) => e[".tag"] === "file")
              .map((e: any) => ({ name: e.name || "", path: e.path_display || e.path_lower || "" }));
          }
        }
      }
    } catch {}

    // 方法2: 方法1失敗時、共有リンクからファイル一覧を取得
    if (files.length === 0) {
      try {
        const listRes2 = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
          body: JSON.stringify({ path: "", shared_link: { url: shareUrl }, limit: 200 }),
          signal: AbortSignal.timeout(15000),
        });
        if (listRes2.ok) {
          const listData2 = await listRes2.json();
          files = (listData2.entries || [])
            .filter((e: any) => e[".tag"] === "file")
            .map((e: any) => ({ name: e.name || "", path: e.path_display || e.path_lower || "" }));
        }
      } catch {}
    }

    if (files.length === 0) return { urls: [], debug: "フォルダ内にファイルが0件" };

    // 日付を含む画像ファイルをフィルタ
    const dateMatches = files.filter(f => {
      if (!/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f.name)) return false;
      return f.name.includes(dateCompact);
    });

    if (dateMatches.length === 0) {
      return { urls: [], debug: `フォルダ内${files.length}件中「${dateCompact}」マッチ0件。ファイル例: ${files.slice(0, 3).map(f => f.name).join(", ")}` };
    }

    // 全マッチファイルのDLリンクを取得
    const urls: string[] = [];
    for (const file of dateMatches.slice(0, 10)) {
      try {
        // 共有リンク経由のファイルはget_shared_link_fileではなくget_temporary_linkを使用
        const linkRes = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
          body: JSON.stringify({ path: file.path }),
          signal: AbortSignal.timeout(10000),
        });
        if (linkRes.ok) {
          const linkData = await linkRes.json();
          if (linkData.link) urls.push(linkData.link);
        }
      } catch {}
    }

    return { urls, debug: urls.length > 0 ? `${urls.length}枚取得（${dateMatches.length}件マッチ）` : `${dateMatches.length}件マッチしたがDLリンク取得失敗` };
  } catch (e: any) {
    return { urls: [], debug: `例外: ${e?.message}` };
  }
}

// 後方互換: 1枚だけ返す旧インターフェース
async function searchDropboxPhotoWithDebug(folderUrl: string, dateCompact: string, shopName: string): Promise<{ url: string; debug: string }> {
  const result = await searchDropboxPhotosMultiple(folderUrl, dateCompact, shopName);
  return { url: result.urls[0] || "", debug: result.debug };
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
  const { sheetId, targetDate, dryRun, topicType, batchOffset, batchSize } = body as {
    sheetId: string;
    targetDate: string; // "2026-04-11"
    dryRun?: boolean;
    topicType?: string; // "STANDARD" | "OFFER" | "EVENT" | "PHOTO"
    batchOffset?: number; // バッチ開始位置
    batchSize?: number; // バッチサイズ（デフォルト10）
  };
  const isPhotoOnly = topicType === "PHOTO";

  if (!sheetId || !targetDate) {
    return NextResponse.json({ error: "sheetIdとtargetDateが必要です" }, { status: 400 });
  }

  // 日付フォーマット変換
  const dateObj = new Date(targetDate);
  const dateCompact = `${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${dateObj.getDate()}`; // "26-4-24"形式
  const dateSlash = `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
  const dateSlashPad = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

  // 対象タブを読み込み
  const tabs = ["投稿用シート", "報告必須店舗 投稿用シート", "WHITE 系列 投稿用シート"];
  const allMatches: { shopName: string; summary: string; photoUrl: string; tab: string; rawPhotoCell: string; rawDateCell: string; photoDebug: string }[] = [];
  const pendingPhotoSearch: { index: number; photoCell: string; shopName: string }[] = [];

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

        // dryRun（プレビュー）時はDropbox写真検索をスキップ → 高速化
        if (dryRun) {
          const hasPhoto = !!photoCell;
          allMatches.push({ shopName, summary: postText, photoUrl: "", tab, rawPhotoCell: photoCell, rawDateCell: dateCell, photoDebug: hasPhoto ? "写真あり（確認時はスキップ）" : "F列が空" });
          continue;
        }

        // 実行時: 一旦写真なしでマッチを記録（後で並列検索）
        pendingPhotoSearch.push({ index: allMatches.length, photoCell, shopName });
        allMatches.push({ shopName, summary: postText, photoUrl: "", tab, rawPhotoCell: photoCell, rawDateCell: dateCell, photoDebug: "" });
      }
    } catch (e) {
      console.error(`[auto-post] Tab "${tab}" error:`, e);
    }
  }

  // Dropbox写真検索を並列実行（実行時のみ）
  if (!dryRun && pendingPhotoSearch.length > 0) {
    await Promise.all(pendingPhotoSearch.map(async (p) => {
      const match = allMatches[p.index];
      if (!p.photoCell) { match.photoDebug = "F列が空"; return; }

      let photoUrls: string[] = [];
      let photoDebug = "";
      if (p.photoCell.includes("dropbox.com")) {
        const result = await searchDropboxPhotosMultiple(p.photoCell.trim(), dateCompact, p.shopName);
        photoUrls = result.urls;
        photoDebug = result.debug;
      }
      if (photoUrls.length === 0) {
        const urls = p.photoCell.match(/https?:\/\/[^\s,"]+/g) || [];
        const dated = urls.filter((u: string) => u.includes(dateCompact));
        photoUrls = dated.length > 0 ? dated.map(convertDropboxUrl) : [];
      }
      if (photoUrls.length === 0 && !photoDebug) photoDebug = "URLから写真を抽出できません";

      if (isPhotoOnly) {
        // 写真のみ: 1枚目をこのマッチに、残りを追加
        match.photoUrl = photoUrls[0] || "";
        match.photoDebug = photoUrls.length > 0 ? `写真1/${photoUrls.length}` : photoDebug;
        for (let pi = 1; pi < photoUrls.length; pi++) {
          allMatches.push({ ...match, summary: "", photoUrl: photoUrls[pi], photoDebug: `写真${pi + 1}/${photoUrls.length}` });
        }
      } else if (photoUrls.length <= 1) {
        match.photoUrl = photoUrls[0] || "";
        match.photoDebug = photoUrls.length > 0 ? `写真${photoUrls.length}枚取得` : photoDebug;
      } else {
        match.photoUrl = photoUrls[0];
        match.photoDebug = `写真${photoUrls.length}枚取得（1/${photoUrls.length}）`;
        for (let pi = 1; pi < photoUrls.length; pi++) {
          allMatches.push({ ...match, summary: "", photoUrl: photoUrls[pi], photoDebug: `写真${pi + 1}/${photoUrls.length}` });
        }
      }
    }));
  }

  if (allMatches.length === 0) {
    return NextResponse.json({ matches: 0, message: `${targetDate}に該当する投稿データがありません`, dateCompact });
  }

  if (dryRun) {
    // プレビュー時はバッチ情報も返す
    const bs = batchSize || 10;
    const totalBatches = Math.ceil(allMatches.length / bs);
    return NextResponse.json({
      matches: allMatches.length,
      data: allMatches,
      totalBatches,
      batchSize: bs,
      message: allMatches.length > bs
        ? `プレビュー: ${allMatches.length}件を${bs}件ずつ${totalBatches}回に分けて実行します`
        : "プレビュー（実際の投稿はしません）",
    });
  }

  // バッチ分割: batchOffset/batchSizeが指定されている場合、その範囲のみ実行
  const offset = batchOffset || 0;
  const size = batchSize || allMatches.length; // 未指定時は全件
  const batchMatches = allMatches.slice(offset, offset + size);

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

  for (const match of batchMatches) {
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

    const { resolveLocationName } = await import("@/lib/gbp-location");
    const locationName = await resolveLocationName(shop.gbp_location_name);
    if (!locationName) { results.push({ shop: shop.name, status: "ロケーション解決失敗" }); continue; }

    // 写真のみ投稿（追加写真）の場合はGBP Media APIで直接アップロード
    if (!match.summary && match.photoUrl) {
      try {
        const directUrl = match.photoUrl.includes("dropboxusercontent.com") || match.photoUrl.includes("dl.dropbox")
          ? match.photoUrl : convertDropboxUrl(match.photoUrl);
        const mediaRes = await fetch(`${GBP_API_BASE}/${locationName}/media`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ mediaFormat: "PHOTO", sourceUrl: directUrl, locationAssociation: { category: "ADDITIONAL" } }),
          signal: AbortSignal.timeout(30000),
        });
        if (mediaRes.ok) {
          results.push({ shopName: match.shopName, status: "写真投稿成功", summary: `写真: ${match.photoDebug}` });
          posted++;
        } else {
          results.push({ shopName: match.shopName, status: `写真エラー(${mediaRes.status})`, summary: match.photoDebug });
          errors++;
        }
      } catch (e: any) {
        results.push({ shopName: match.shopName, status: `写真エラー: ${e?.message}`, summary: match.photoDebug });
        errors++;
      }
      continue;
    }

    // 本文を1500文字に制限
    const trimmedSummary = match.summary.slice(0, 1500);
    const postBody: any = { summary: trimmedSummary, topicType: "STANDARD", languageCode: "ja" };
    if (match.photoUrl) {
      const directUrl = match.photoUrl.includes("dropboxusercontent.com") || match.photoUrl.includes("dl.dropbox")
        ? match.photoUrl : convertDropboxUrl(match.photoUrl);
      postBody.media = [{ mediaFormat: "PHOTO", sourceUrl: directUrl }];
    }

    try {
      let res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(postBody),
        signal: AbortSignal.timeout(30000),
      });

      // 写真付きで失敗したら写真なしでリトライ
      if (!res.ok && match.photoUrl) {
        const retryBody = { summary: trimmedSummary, topicType: "STANDARD", languageCode: "ja" };
        res = await fetch(`${GBP_API_BASE}/${locationName}/localPosts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify(retryBody),
          signal: AbortSignal.timeout(30000),
        });
      }

      if (res.ok) {
        const result = await res.json();
        // GBPレスポンスにname（投稿ID）があるか検証
        if (result.name) {
          await supabase.from("post_logs").insert({
            id: crypto.randomUUID(), shop_id: shop.id, shop_name: shop.name,
            summary: match.summary, topic_type: "STANDARD",
            media_url: match.photoUrl || null, search_url: result.searchUrl || null,
            gbp_post_name: result.name,
          });
          results.push({ shopName: match.shopName, status: "投稿成功", summary: match.summary.slice(0, 30), gbpPostName: result.name, searchUrl: result.searchUrl });
          posted++;
        } else {
          // HTTP 200だがGBP投稿が作成されていない
          console.error(`[auto-post] GBP returned 200 but no post name:`, JSON.stringify(result).slice(0, 500));
          results.push({ shopName: match.shopName, status: "GBP応答異常（投稿ID無し）", detail: JSON.stringify(result).slice(0, 300), summary: match.summary.slice(0, 30), locationName });
          errors++;
        }
      } else {
        const err = await res.text().catch(() => "");
        console.error(`[auto-post] GBP API error: ${res.status}`, err.slice(0, 500));
        results.push({ shopName: match.shopName, status: `GBPエラー(${res.status})`, detail: err.slice(0, 300), summary: match.summary.slice(0, 30), photoUrl: match.photoUrl, locationName });
        errors++;
      }
    } catch (e: any) {
      results.push({ shopName: match.shopName, status: `エラー: ${e?.message}`, summary: match.summary.slice(0, 30) });
      errors++;
    }
  }

  return NextResponse.json({
    matches: allMatches.length,
    posted, errors, results,
    batchOffset: offset,
    batchSize: size,
    batchProcessed: batchMatches.length,
    hasMore: offset + size < allMatches.length,
    nextOffset: offset + size,
  });
}
