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
  if (!DROPBOX_APP_KEY || !DROPBOX_REFRESH_TOKEN) {
    console.error("[Dropbox] DROPBOX_APP_KEY or DROPBOX_REFRESH_TOKEN not set");
    return null;
  }

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
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[Dropbox] Token refresh failed: ${res.status}`, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    if (!data.access_token) {
      console.error("[Dropbox] No access_token in response");
      return null;
    }
    cachedDropboxToken = { token: data.access_token, expires: Date.now() + (data.expires_in - 60) * 1000 };
    return data.access_token;
  } catch (e: any) {
    console.error("[Dropbox] Token fetch error:", e?.message);
    return null;
  }
}

/**
 * Dropbox共有リンクからフォルダ内のファイルをリストし、日付マッチする全写真のDLリンクを取得
 */
async function searchDropboxPhotosMultiple(folderUrl: string, dateCompact: string, shopName: string): Promise<{ urls: string[]; debug: string }> {
  const dbxToken = await getDropboxAccessToken();
  if (!dbxToken) return { urls: [], debug: "Dropboxトークン取得失敗" };

  try {
    // 共有リンクURL正規化
    let shareUrl = folderUrl.trim();
    // dl=0/1, st=セッショントークンを除去（API認識を妨げる）
    shareUrl = shareUrl.replace(/[&?]dl=\d/g, "").replace(/[&?]st=[^&]*/g, "").replace(/[?&]$/, "");

    let files: { name: string; path: string }[] = [];
    let debugSteps: string[] = [];

    // 共有リンク経由でフォルダ内ファイル一覧（サブフォルダも手動で再帰展開）
    // shared_linkではrecursive非対応のため、サブフォルダを個別にlist_folder
    const listSharedFolder = async (relativePath: string): Promise<{ files: any[]; folders: any[] }> => {
      const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
        body: JSON.stringify({ path: relativePath, shared_link: { url: shareUrl }, limit: 2000 }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        debugSteps.push(`list(${relativePath || "/"}): HTTP${res.status} ${body.slice(0, 100)}`);
        return { files: [], folders: [] };
      }
      const data = await res.json();
      let allEntries = data.entries || [];
      // ページネーション
      let hasMore = data.has_more;
      let cursor = data.cursor;
      while (hasMore && cursor) {
        try {
          const contRes = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ cursor }),
            signal: AbortSignal.timeout(15000),
          });
          if (contRes.ok) {
            const contData = await contRes.json();
            allEntries = allEntries.concat(contData.entries || []);
            hasMore = contData.has_more;
            cursor = contData.cursor;
          } else { break; }
        } catch { break; }
      }
      return {
        files: allEntries.filter((e: any) => e[".tag"] === "file"),
        folders: allEntries.filter((e: any) => e[".tag"] === "folder"),
      };
    }

    try {
      // ルートフォルダを取得
      const root = await listSharedFolder("");
      files.push(...root.files.map((e: any) => ({ name: e.name || "", path: e.path_display || e.path_lower || "" })));

      // サブフォルダを最大3階層まで再帰展開（パスは共有ルートからの相対パス）
      const pendingFolders = root.folders.map((f: any) => ({
        // 共有リンクのlist_folderでは相対パスを使う必要がある
        // path_displayが返される場合もあるが、安全のため name ベースで組み立て
        relativePath: `/${f.name}`,
        depth: 1,
      }));
      while (pendingFolders.length > 0) {
        const sf = pendingFolders.shift()!;
        if (sf.depth > 3) continue; // 3階層まで
        try {
          const sub = await listSharedFolder(sf.relativePath);
          files.push(...sub.files.map((e: any) => ({ name: e.name || "", path: e.path_display || e.path_lower || "" })));
          // さらに深いサブフォルダがあれば追加
          for (const f of sub.folders) {
            pendingFolders.push({
              relativePath: `${sf.relativePath}/${f.name}`,
              depth: sf.depth + 1,
            });
          }
        } catch {}
      }
      debugSteps.push(`${files.length}件のファイル発見(フォルダ${root.folders.length}個+サブ展開)`);
    } catch (e: any) {
      debugSteps.push(`list_folder例外: ${e?.message}`);
    }

    if (files.length === 0) return { urls: [], debug: `フォルダ内にファイルが0件 [${debugSteps.join(" → ")}] URL: ${shareUrl.slice(0, 80)}` };

    // 日付を含む画像ファイルをフィルタ（ファイル名に dateCompact "26-4-12" 形式で部分一致）
    const dateMatches = files.filter(f => {
      if (!/\.(jpg|jpeg|png|gif|webp|bmp)$/i.test(f.name)) return false;
      return f.name.includes(dateCompact);
    });

    if (dateMatches.length === 0) {
      return { urls: [], debug: `フォルダ内${files.length}件中「${dateCompact}」マッチ0件。ファイル例: ${files.slice(0, 5).map(f => f.name).join(", ")}` };
    }

    // 全マッチファイルのDLリンクを取得
    const urls: string[] = [];
    let dlDebug: string[] = [];

    // 共有フォルダのルート絶対パスを取得（get_temporary_link用）
    let sharedRootPath = "";
    try {
      const metaRes = await fetch("https://api.dropboxapi.com/2/sharing/get_shared_link_metadata", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
        body: JSON.stringify({ url: shareUrl }),
        signal: AbortSignal.timeout(10000),
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        sharedRootPath = meta.path_lower || "";
        dlDebug.push(`共有ルート: ${sharedRootPath}`);
      }
    } catch {}

    for (const file of dateMatches.slice(0, 10)) {
      let got = false;

      // 方法1: get_temporary_link（パスをそのまま試行）
      try {
        const linkRes = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
          body: JSON.stringify({ path: file.path }),
          signal: AbortSignal.timeout(10000),
        });
        if (linkRes.ok) {
          const linkData = await linkRes.json();
          if (linkData.link) { urls.push(linkData.link); got = true; }
        }
      } catch {}

      // 方法2: 共有ルートパス + 相対パスで再試行
      if (!got && sharedRootPath) {
        const absPath = file.path.startsWith(sharedRootPath)
          ? file.path
          : `${sharedRootPath}${file.path.startsWith("/") ? "" : "/"}${file.path}`;
        try {
          const linkRes2 = await fetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ path: absPath }),
            signal: AbortSignal.timeout(10000),
          });
          if (linkRes2.ok) {
            const linkData2 = await linkRes2.json();
            if (linkData2.link) { urls.push(linkData2.link); got = true; }
          } else {
            dlDebug.push(`方法2失敗(${linkRes2.status}): ${absPath.slice(0, 60)}`);
          }
        } catch {}
      }

      // 方法3: ファイル単体の共有リンクを新規作成
      if (!got) {
        const tryPath = sharedRootPath
          ? `${sharedRootPath}${file.path.startsWith("/") ? "" : "/"}${file.path}`
          : file.path;
        try {
          const shareRes = await fetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ path: tryPath, settings: { requested_visibility: "public", access: "viewer" } }),
            signal: AbortSignal.timeout(10000),
          });
          const shareBody = await shareRes.json();
          const fileShareUrl = shareBody?.url || shareBody?.error?.shared_link_already_exists?.metadata?.url;
          if (fileShareUrl) {
            urls.push(fileShareUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/\?dl=0/, "?dl=1"));
            got = true;
          } else {
            dlDebug.push(`方法3失敗: ${JSON.stringify(shareBody).slice(0, 100)}`);
          }
        } catch {}
      }
    }

    const debugExtra = dlDebug.length > 0 ? ` [${dlDebug.join("; ")}]` : "";
    return { urls, debug: urls.length > 0 ? `${urls.length}枚取得（${dateMatches.length}件マッチ）${debugExtra}` : `${dateMatches.length}件マッチしたがDLリンク取得失敗${debugExtra}` };
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
  const { sheetId, targetDate, dryRun, topicType, batchOffset, batchSize, filterShopName, filterShopNames, scheduleMode, scheduleAt } = body as {
    sheetId: string;
    targetDate: string; // "2026-04-11"
    dryRun?: boolean;
    topicType?: string; // "STANDARD" | "OFFER" | "EVENT" | "PHOTO"
    batchOffset?: number; // バッチ開始位置
    batchSize?: number; // バッチサイズ（デフォルト10）
    filterShopName?: string; // 特定店舗のみに絞り込み（単一）
    filterShopNames?: string[]; // 特定店舗リストに絞り込み（再実行用）
    scheduleMode?: boolean; // true: 即時投稿ではなく予約投稿として保存
    scheduleAt?: string; // 予約日時 "2026-04-12T09:00:00"（scheduleMode時）
  };
  const isPhotoOnly = topicType === "PHOTO";

  if (!sheetId || !targetDate) {
    return NextResponse.json({ error: "sheetIdとtargetDateが必要です" }, { status: 400 });
  }

  // 日付フォーマット変換
  const dateObj = new Date(targetDate);
  const dateCompact = `${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${dateObj.getDate()}`; // "26-4-12" — 写真投稿のDropboxファイル名用
  const dateYymmdd = `${String(dateObj.getFullYear()).slice(2)}${String(dateObj.getMonth() + 1).padStart(2, "0")}${String(dateObj.getDate()).padStart(2, "0")}`; // "260412" — 写真以外のDropboxファイル名用
  const dateYmd = `${dateObj.getFullYear()}${String(dateObj.getMonth() + 1).padStart(2, "0")}${String(dateObj.getDate()).padStart(2, "0")}`; // "20260412" — スプレッドシートE列用
  const dateSlash = `${dateObj.getFullYear()}/${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
  const dateSlashPad = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

  // 写真投稿番号: 対象日付の「日」= 月内の投稿番号
  // 例: 5/1→1投稿目, 5/2→2投稿目, 5/3→3投稿目
  // ファイル名: "写真投稿26-5-1 (1).jpg" = 2026年5月の1投稿目の1枚目
  const photoPostNumber = dateObj.getDate();

  // 対象タブを読み込み
  const tabs = ["投稿用シート", "報告必須店舗 投稿用シート", "WHITE 系列 投稿用シート"];
  const allMatches: { shopName: string; summary: string; photoUrl: string; ctaUrl: string; tab: string; rawPhotoCell: string; rawDateCell: string; photoDebug: string; topicType: string; offerTitle: string; offerStartDate: any; offerEndDate: any }[] = [];
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
        const aCell = (row[0] || "").trim(); // A列（index 0）投稿タイプ判定
        const shopName = (row[1] || "").trim(); // B列（index 1）
        const postText = (row[2] || "").trim(); // C列（index 2）
        const dateCell = (row[4] || "").trim(); // E列（index 4）
        const photoCell = (row[5] || "").trim(); // F列（index 5）
        const offerTitle = (row[7] || "").trim(); // H列（index 7）特典用の題名
        const ctaUrl = (row[9] || "").trim(); // J列（index 9）CTAボタンURL

        // WHITE系列タブ: A列に「特典投稿」→OFFER、それ以外→STANDARD
        const isOffer = tab === "WHITE 系列 投稿用シート" && aCell.includes("特典投稿");
        const rowTopicType = isPhotoOnly ? "PHOTO" : isOffer ? "OFFER" : "STANDARD";

        // OFFER: 開始日=投稿日、終了日=月末
        const offerStartDate = isOffer ? { year: dateObj.getFullYear(), month: dateObj.getMonth() + 1, day: dateObj.getDate() } : null;
        const offerEndDate = isOffer ? { year: dateObj.getFullYear(), month: dateObj.getMonth() + 1, day: new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate() } : null;

        if (!shopName) continue;
        if (!isPhotoOnly && !postText) continue; // 写真のみ投稿ではテキスト不要

        if (isPhotoOnly) {
          // 写真投稿: E列日付は見ない。B列店舗名 + F列DropboxURLのみ
          if (!photoCell) continue; // F列が空ならスキップ
        } else {
          // 通常投稿: 日付マッチ（複数フォーマット対応）
          const dateMatch = dateCell.includes(dateYmd)
            || dateCell.includes(dateCompact)
            || dateCell.includes(dateSlash)
            || dateCell.includes(dateSlashPad)
            || dateCell.includes(targetDate);
          if (!dateMatch) continue;
        }

        // 店舗フィルタ（特定店舗が指定されている場合、その店舗のみ対象）
        if (filterShopNames && filterShopNames.length > 0) {
          const match = filterShopNames.some(fn => shopName === fn || shopName.includes(fn) || fn.includes(shopName));
          if (!match) continue;
        } else if (filterShopName && shopName !== filterShopName && !shopName.includes(filterShopName) && !filterShopName.includes(shopName)) continue;

        // 写真投稿: 同じ店舗が複数行にある場合は最初の1行のみ使用
        if (isPhotoOnly && allMatches.some(m => m.shopName === shopName)) continue;

        // dryRun（プレビュー）時はDropbox写真検索をスキップ → 高速化
        if (dryRun) {
          const hasPhoto = !!photoCell;
          allMatches.push({ shopName, summary: postText || (isPhotoOnly ? "（写真のみ）" : ""), photoUrl: "", ctaUrl, tab, rawPhotoCell: photoCell, rawDateCell: dateCell, photoDebug: hasPhoto ? `写真あり（投稿番号: ${photoPostNumber}）` : "F列が空", topicType: rowTopicType, offerTitle: isOffer ? offerTitle : "", offerStartDate, offerEndDate });
          continue;
        }

        // 実行時: 一旦写真なしでマッチを記録（後で並列検索）
        pendingPhotoSearch.push({ index: allMatches.length, photoCell, shopName });
        allMatches.push({ shopName, summary: postText || "", photoUrl: "", ctaUrl, tab, rawPhotoCell: photoCell, rawDateCell: dateCell, photoDebug: "", topicType: rowTopicType, offerTitle: isOffer ? offerTitle : "", offerStartDate, offerEndDate });
      }
    } catch (e) {
      console.error(`[auto-post] Tab "${tab}" error:`, e);
    }
  }

  // Dropbox写真検索を5件ずつバッチ実行（レート制限対策）
  if (!dryRun && pendingPhotoSearch.length > 0) {
    const PHOTO_BATCH = 5;
    for (let bi = 0; bi < pendingPhotoSearch.length; bi += PHOTO_BATCH) {
      const batch = pendingPhotoSearch.slice(bi, bi + PHOTO_BATCH);
      await Promise.all(batch.map(async (p) => {
      const match = allMatches[p.index];
      if (!p.photoCell) { match.photoDebug = "F列が空"; return; }

      let photoUrls: string[] = [];
      let photoDebug = "";
      // 写真投稿: "26-5-1" = 月内の投稿番号、通常投稿: "260412" = 日付
      const fileNameDate = isPhotoOnly
        ? `${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${photoPostNumber}`
        : dateYymmdd;
      if (p.photoCell.includes("dropbox.com")) {
        const result = await searchDropboxPhotosMultiple(p.photoCell.trim(), fileNameDate, p.shopName);
        photoUrls = result.urls;
        photoDebug = result.debug;
      }
      if (photoUrls.length === 0) {
        const urls = p.photoCell.match(/https?:\/\/[^\s,"]+/g) || [];
        const dated = urls.filter((u: string) => u.includes(fileNameDate));
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
  }

  if (allMatches.length === 0) {
    // デバッグ: なぜ0件か情報を返す
    const tabResults: string[] = [];
    for (const tab of tabs) {
      try {
        const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
        const res = await fetch(gvizUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
          redirect: "follow",
        });
        if (!res.ok) { tabResults.push(`${tab}: HTTP${res.status}`); continue; }
        const csvText = await res.text();
        if (csvText.includes("<!DOCTYPE") || csvText.includes("<html")) { tabResults.push(`${tab}: HTMLが返された`); continue; }
        const rows = parseCSV(csvText);
        const shopNames = rows.slice(1, 6).map(r => (r[1] || "").trim()).filter(Boolean);
        const photoCells = rows.slice(1, 6).map(r => (r[5] || "").slice(0, 30)).filter(Boolean);
        tabResults.push(`${tab}: ${rows.length}行, B列例:[${shopNames.join(",")}], F列例:[${photoCells.join(",")}]`);
      } catch (e: any) { tabResults.push(`${tab}: エラー ${e?.message}`); }
    }
    return NextResponse.json({
      matches: 0,
      message: `${targetDate}に該当する投稿データがありません`,
      debug: { isPhotoOnly, topicType, dateCompact, photoPostNumber, tabResults, filterShopName, filterShopNames },
    });
  }

  if (dryRun) {
    // プレビュー時はバッチ情報も返す
    const bs = batchSize || 10;
    const totalBatches = Math.ceil(allMatches.length / bs);
    const photoFilePattern = isPhotoOnly
      ? `写真投稿${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${photoPostNumber}`
      : undefined;
    return NextResponse.json({
      matches: allMatches.length,
      data: allMatches,
      totalBatches,
      batchSize: bs,
      photoPostNumber: isPhotoOnly ? photoPostNumber : undefined,
      photoFilePattern,
      message: isPhotoOnly
        ? `プレビュー: ${allMatches.length}件（${photoFilePattern} を検索）`
        : allMatches.length > bs
          ? `プレビュー: ${allMatches.length}件を${bs}件ずつ${totalBatches}回に分けて実行します`
          : "プレビュー（実際の投稿はしません）",
    });
  }

  // バッチ分割: batchOffset/batchSizeが指定されている場合、その範囲のみ実行
  const offset = batchOffset || 0;
  const size = batchSize || allMatches.length; // 未指定時は全件
  const batchMatches = allMatches.slice(offset, offset + size);

  const supabase = getSupabase();
  const { data: shops } = await supabase.from("shops")
    .select("id, name, gbp_location_name, gbp_shop_name")
    .not("gbp_location_name", "is", null);

  // 差し込み文字列を一括取得（shop_idとshop_name両方でマッチできるように）
  const fixedMsgByShopId: Record<string, string> = {};
  const fixedMsgByShopName: Record<string, string> = {};
  try {
    // fixed_messagesにshop_nameカラムがない場合はshops経由で名前を解決
    const { data: allFixedMsgs } = await supabase.from("fixed_messages").select("shop_id, message");
    if (allFixedMsgs) {
      // shop_id→shop_nameのマッピングを構築
      const shopIdToName: Record<string, string> = {};
      for (const s of (shops || [])) { shopIdToName[s.id] = s.name; }
      // 全shop一覧から追加（gbp_location_nameがnullの店舗も含む）
      const { data: allShopsForName } = await supabase.from("shops").select("id, name");
      if (allShopsForName) {
        for (const s of allShopsForName) { shopIdToName[s.id] = s.name; }
      }

      for (const fm of allFixedMsgs) {
        if (fm.shop_id && fm.message) {
          fixedMsgByShopId[fm.shop_id] = fixedMsgByShopId[fm.shop_id]
            ? `${fixedMsgByShopId[fm.shop_id]}\n${fm.message}`
            : fm.message;
          // shop_name経由でもマッチできるように
          const name = shopIdToName[fm.shop_id];
          if (name) {
            fixedMsgByShopName[name] = fixedMsgByShopName[name]
              ? `${fixedMsgByShopName[name]}\n${fm.message}`
              : fm.message;
          }
        }
      }
    }
  } catch {}

  // shop_idまたはshop_nameで差し込み文字列を取得するヘルパー
  const getFixedMsg = (shopId: string, shopName: string): string => {
    return fixedMsgByShopId[shopId] || fixedMsgByShopName[shopName] || "";
  };

  // === 予約投稿モード: scheduled_postsテーブルに保存して終了 ===
  if (scheduleMode) {
    const scheduledTime = scheduleAt || `${targetDate}T09:00:00+09:00`;
    let scheduled = 0;
    let schedErrors = 0;
    const schedResults: any[] = [];

    for (const match of batchMatches) {
      if (isPhotoOnly && !match.photoUrl) {
        schedResults.push({ shopName: match.shopName, status: "写真なし（スキップ）", detail: match.photoDebug });
        schedErrors++;
        continue;
      }
      if (!isPhotoOnly && !match.summary) {
        schedResults.push({ shopName: match.shopName, status: "本文なし（スキップ）" });
        schedErrors++;
        continue;
      }
      const shop = (shops || []).find((s) =>
        s.name === match.shopName || s.gbp_shop_name === match.shopName
        || s.name.includes(match.shopName) || match.shopName.includes(s.name)
      );
      if (!shop) {
        schedResults.push({ shopName: match.shopName, status: "店舗未登録（スキップ）" });
        schedErrors++;
        continue;
      }

      // 差し込み文字列を投稿文に結合（shop_idまたはshop_nameでマッチ）
      const fixedMsg = getFixedMsg(shop.id, shop.name);
      if (!isPhotoOnly && match.summary && fixedMsg) {
        match.summary = `${match.summary}\n\n${fixedMsg}`;
      }

      // === 予約投稿バリデーション ===
      const warnings: string[] = [];

      // 1. CTAリンク生存確認（J列にURLがある場合）
      if (match.ctaUrl) {
        try {
          const linkRes = await fetch(match.ctaUrl, { method: "HEAD", signal: AbortSignal.timeout(8000), redirect: "follow" });
          if (!linkRes.ok) warnings.push(`CTAリンク異常(${linkRes.status}): ${match.ctaUrl.slice(0, 60)}`);
        } catch {
          warnings.push(`CTAリンク到達不可: ${match.ctaUrl.slice(0, 60)}`);
        }
      } else if (!isPhotoOnly) {
        warnings.push("CTAリンク(J列)が未設定");
      }

      // 2. 店舗名が投稿文中に3回未満なら警告（SEO対策: 3回以上推奨）
      if (!isPhotoOnly && match.summary) {
        const shopNameForCount = shop.name;
        const nameCount = (match.summary.split(shopNameForCount).length - 1);
        if (nameCount < 3) warnings.push(`店舗名「${shopNameForCount}」が本文中に${nameCount}回（3回以上推奨）`);
      }

      // 警告ありなら保留（on_hold）、なしなら予約（pending）
      const postStatus = warnings.length > 0 ? "on_hold" : "pending";

      try {
        const { error: insertErr } = await supabase.from("scheduled_posts").insert({
          id: crypto.randomUUID(),
          shop_id: shop.id,
          shop_name: shop.name,
          summary: match.summary || "",
          topic_type: match.topicType || "STANDARD",
          photo_url: match.photoUrl || null,
          action_type: match.ctaUrl ? "LEARN_MORE" : null,
          action_url: match.ctaUrl || null,
          scheduled_at: scheduledTime,
          status: postStatus,
          offer_title: match.offerTitle || null,
          offer_start_date: match.offerStartDate || null,
          offer_end_date: match.offerEndDate || null,
        });
        if (insertErr) {
          schedResults.push({ shopName: match.shopName, status: `DB保存エラー: ${insertErr.message}` });
          schedErrors++;
        } else if (warnings.length > 0) {
          schedResults.push({ shopName: match.shopName, status: `保留（要確認）`, warnings, savedSummary: (match.summary || "").slice(0, 80), savedCtaUrl: match.ctaUrl || "" });
          schedErrors++;
        } else {
          schedResults.push({ shopName: match.shopName, status: "予約登録成功", warnings: [], savedSummary: (match.summary || "").slice(0, 80), savedCtaUrl: match.ctaUrl || "" });
          scheduled++;
        }
      } catch (e: any) {
        schedResults.push({ shopName: match.shopName, status: `エラー: ${e?.message}` });
        schedErrors++;
      }
    }

    return NextResponse.json({
      matches: allMatches.length,
      posted: scheduled, errors: schedErrors, results: schedResults,
      batchOffset: offset, batchSize: size, batchProcessed: batchMatches.length,
      hasMore: offset + size < allMatches.length, nextOffset: offset + size,
      scheduleMode: true, scheduledAt: scheduledTime,
    });
  }

  // === 即時投稿モード ===
  const accessToken = await getOAuthToken();
  if (!accessToken) return NextResponse.json({ error: "OAuthトークンなし" }, { status: 500 });

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

    // 差し込み文字列を投稿文に結合（即時投稿）
    const fixedMsgImm = getFixedMsg(shop.id, shop.name);
    if (!isPhotoOnly && match.summary && fixedMsgImm) {
      match.summary = `${match.summary}\n\n${fixedMsgImm}`;
    }

    const { resolveLocationName } = await import("@/lib/gbp-location");
    const locationName = await resolveLocationName(shop.gbp_location_name);
    if (!locationName) { results.push({ shop: shop.name, status: "ロケーション解決失敗" }); continue; }

    // 写真のみモード: GBP Media APIで写真アップロードのみ（テキスト投稿しない）
    if (isPhotoOnly) {
      if (!match.photoUrl) {
        results.push({ shopName: match.shopName, status: "写真なし（スキップ）", detail: match.photoDebug || "Dropboxから写真取得失敗", summary: `F列: ${match.rawPhotoCell?.slice(0, 80) || "空"}`, dateCompact });
        errors++;
        continue;
      }
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
          const err = await mediaRes.text().catch(() => "");
          results.push({ shopName: match.shopName, status: `写真エラー(${mediaRes.status})`, detail: err.slice(0, 200), summary: match.photoDebug });
          errors++;
        }
      } catch (e: any) {
        results.push({ shopName: match.shopName, status: `写真エラー: ${e?.message}`, summary: match.photoDebug });
        errors++;
      }
      continue;
    }

    // 通常投稿: テキスト無しでsummaryが空の場合はMedia APIで写真のみアップロード
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
    const postBody: any = { summary: trimmedSummary, topicType: match.topicType || "STANDARD", languageCode: "ja" };
    // 特典投稿（OFFER）: 題名+開始日+終了日
    if (match.topicType === "OFFER" && match.offerTitle) {
      postBody.event = {
        title: match.offerTitle,
        schedule: { startDate: match.offerStartDate, endDate: match.offerEndDate },
      };
    }
    // J列にURLがあれば「詳細」CTAボタンを設定
    if (match.ctaUrl) {
      postBody.callToAction = { actionType: "LEARN_MORE", url: match.ctaUrl };
    }
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
        const retryBody: any = { summary: trimmedSummary, topicType: "STANDARD", languageCode: "ja" };
        if (match.ctaUrl) retryBody.callToAction = { actionType: "LEARN_MORE", url: match.ctaUrl };
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
          // GBPに実際に投稿が存在するか確認（GET投稿）
          let verified = false;
          try {
            const verifyRes = await fetch(`${GBP_API_BASE}/${result.name}`, {
              headers: { Authorization: `Bearer ${accessToken}` },
              signal: AbortSignal.timeout(10000),
            });
            verified = verifyRes.ok;
          } catch {}
          results.push({ shopName: match.shopName, status: verified ? "投稿成功（確認済み）" : "投稿成功（未確認）", summary: match.summary.slice(0, 30), gbpPostName: result.name, searchUrl: result.searchUrl, verified });
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

  const photoFilePattern = isPhotoOnly
    ? `写真投稿${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${photoPostNumber}`
    : undefined;

  return NextResponse.json({
    matches: allMatches.length,
    posted, errors, results,
    batchOffset: offset,
    batchSize: size,
    batchProcessed: batchMatches.length,
    hasMore: offset + size < allMatches.length,
    nextOffset: offset + size,
    photoPostNumber: isPhotoOnly ? photoPostNumber : undefined,
    photoFilePattern,
  });
}
