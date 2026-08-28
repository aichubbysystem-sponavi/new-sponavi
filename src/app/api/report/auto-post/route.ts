import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";
import { detectMediaFormat, isSupportedMediaFile, type GbpMediaFormat } from "@/lib/media-format";
import { explainGbpError } from "@/lib/gbp-error-ja";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

/** Dropboxから取り出したメディア。動画対応のためURLとファイル名を対で持つ */
type MediaItem = { url: string; name: string; webUrl?: string };

/**
 * DropboxのWeb画面でそのファイルを直接開くURL。
 * エラー・スキップの詳細に「どのファイルか」をリンクで示すため（サイズ超過・非対応形式のときに探す手間をなくす）。
 * @param rootPathLower 共有フォルダの絶対パス（get_shared_link_metadata の path_lower）。Dropboxのパスは大文字小文字を区別しない
 * @param relPath 共有フォルダからの相対パス（list_folder の path_display）
 */
function dropboxWebUrl(rootPathLower: string, relPath: string): string {
  if (!rootPathLower || !relPath) return "";
  const full = `${rootPathLower.replace(/\/$/, "")}${relPath.startsWith("/") ? relPath : `/${relPath}`}`;
  const dir = full.slice(0, full.lastIndexOf("/"));
  const file = full.slice(full.lastIndexOf("/") + 1);
  return `https://www.dropbox.com/home${dir.split("/").map(encodeURIComponent).join("/")}?preview=${encodeURIComponent(file)}`;
}

/**
 * 投稿するメディアの形式。ファイル名から判定した結果を最優先し、
 * 無ければURLの拡張子で判定、それも不明なら従来通り写真として扱う。
 */
function mediaFormatOf(match: { mediaFormat?: GbpMediaFormat; mediaFileName?: string }, url: string): GbpMediaFormat {
  return match.mediaFormat
    || detectMediaFormat(match.mediaFileName || "")
    || detectMediaFormat(url)
    || "PHOTO";
}

/** 店舗名の正規化比較（全角半角・スペースの揺れを吸収、部分一致は排除） */
function normName(s: string): string {
  return s.normalize("NFKC").replace(/[\s\u3000]+/g, "").toLowerCase();
}
function matchShopName(a: string, b: string): boolean {
  return normName(a) === normName(b);
}

/**
 * GBP APIを叩く。401/403/404 は「そのトークンからそのロケーションが見えない」だけのことがあるため、
 * 他のOAuthトークンで必ず順番に再試行する。
 *
 * 背景: GBPアカウントは本番で15個あり、1本のトークンで全ロケーションは見えない。
 * 例) 一文字premium         accounts/111148362910776147900 → 既定トークンで通る
 *     西口酒場ホームラン    accounts/111031567193825395772 → 既定トークンでは404
 * cron/execute-posts は全トークンを試すので通るが、即時実行だけ1本しか使っておらず
 * 「予約なら投稿できるのに、実行ボタンだと404」という差が出ていた。
 *
 * 400などトークンと無関係なエラーは再試行しても同じなので即座に打ち切る。
 */
let cachedFallbackTokens: string[] | null = null;
const TOKEN_RETRY_STATUSES = [401, 403, 404];

async function gbpFetchWithTokenFallback(
  url: string,
  init: { method?: string; body?: string; timeoutMs?: number },
  primaryToken: string,
): Promise<{ res: Response; text: string }> {
  const call = async (token: string) => {
    const res = await fetch(url, {
      cache: "no-store" as const,
      method: init.method || "POST",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${token}`,
      },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs || 30000),
    });
    return { res, text: await res.text().catch(() => "") };
  };

  let last = await call(primaryToken);
  if (last.res.ok || !TOKEN_RETRY_STATUSES.includes(last.res.status)) return last;

  if (!cachedFallbackTokens) {
    const { getAllOAuthTokens } = await import("@/lib/gbp-token");
    cachedFallbackTokens = await getAllOAuthTokens();
  }
  for (const token of cachedFallbackTokens) {
    if (token === primaryToken) continue;
    const attempt = await call(token);
    if (attempt.res.ok) return attempt;
    last = attempt;
    if (!TOKEN_RETRY_STATUSES.includes(attempt.res.status)) break;
  }
  return last;
}

const parseJson = (text: string): any => { try { return JSON.parse(text); } catch { return {}; } };

/**
 * スプレッドシートのタブをCSVで取得する。
 * タイムアウトを必ず付けること: Googleが応答しないとサーバーは maxDuration まで待ち続け、
 * クライアント側は先にタイムアウトして「エラー: timeout of 60000ms exceeded」になる。
 * 取得できなかったタブは null を返し、他タブの処理は続行する。
 */
const SHEET_FETCH_TIMEOUT = 25000;
async function fetchSheetCsv(sheetId: string, tab: string, accessToken: string | null): Promise<string | null> {
  const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(tab)}`;
  const headers: Record<string, string> = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const res = await fetch(gvizUrl, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(SHEET_FETCH_TIMEOUT) });
  if (!res.ok) return null;
  const csvText = await res.text();
  // 未認証だとログインページのHTMLが返る
  if (csvText.includes("<!DOCTYPE") || csvText.includes("<html")) return null;
  return csvText;
}
const GBP_CLIENT_ID = process.env.GBP_CLIENT_ID || "";
const GBP_CLIENT_SECRET = process.env.GBP_CLIENT_SECRET || "";


async function getOAuthToken(): Promise<string | null> {
  // Go API経由で有効なトークンを取得（複数アカウント対応）
  const { getOAuthToken: getSharedToken } = await import("@/lib/gbp-token");
  return getSharedToken();
}

const DROPBOX_APP_KEY = process.env.DROPBOX_APP_KEY || "";
const DROPBOX_APP_SECRET = process.env.DROPBOX_APP_SECRET || "";
const DROPBOX_REFRESH_TOKEN = process.env.DROPBOX_REFRESH_TOKEN || "";

/** Dropboxフォルダ探索の深さ上限と訪問フォルダ数上限（深い階層の写真も拾いつつ暴走を防ぐ） */
const DROPBOX_MAX_DEPTH = 6;
const DROPBOX_MAX_FOLDERS = 300;

let cachedDropboxToken: { token: string; expires: number } | null = null;

async function getDropboxAccessToken(): Promise<string | null> {
  if (cachedDropboxToken && cachedDropboxToken.expires > Date.now()) return cachedDropboxToken.token;
  if (!DROPBOX_APP_KEY || !DROPBOX_REFRESH_TOKEN) {
    console.error("[Dropbox] DROPBOX_APP_KEY or DROPBOX_REFRESH_TOKEN not set");
    return null;
  }

  try {
    const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
      cache: "no-store" as const,
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
 * 「店舗未登録」の理由を具体化する。
 * 2026-08-28 ガールズバーPICASSO: shops に4月から登録・GBP連携済みなのに「見つからない」になり、
 * B列のどこが違うのか画面から分からなかった。不可視文字と近い店舗名を出す。
 */
function explainShopMismatch(sheetName: string, shops: { name: string; gbp_shop_name?: string | null }[]): string {
  const parts: string[] = [];
  // 1. 不可視文字・紛らわしい文字の指摘（ゼロ幅スペース/NBSP/BOM/改行/全角英数）
  const hidden: string[] = [];
  for (const ch of Array.from(sheetName)) {
    const cp = ch.codePointAt(0) || 0;
    if ([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].includes(cp)) hidden.push(`ゼロ幅文字(U+${cp.toString(16).toUpperCase()})`);
    else if (cp === 0x00a0) hidden.push("ノーブレークスペース(U+00A0)");
    else if (cp === 0x0a || cp === 0x0d) hidden.push("改行");
    else if (cp === 0x09) hidden.push("タブ");
  }
  if (hidden.length > 0) parts.push(`B列に見えない文字が含まれています: ${Array.from(new Set(hidden)).join("・")}（セルを入力し直してください）`);
  if (/[Ａ-Ｚａ-ｚ０-９]/.test(sheetName)) parts.push("B列に全角英数字が含まれています（照合は半角に揃えて比較しますが念のため確認）");
  // 2. 近い店舗名（3文字の共通部分で近さを数える）
  const grams = (n: string) => { const g = new Set<string>(); for (let i = 0; i + 3 <= n.length; i++) g.add(n.slice(i, i + 3)); return g; };
  const target = normName(sheetName);
  const tg = grams(target);
  const near = shops
    .map(sh => { const fg = grams(normName(sh.name)); let c = 0; tg.forEach(x => { if (fg.has(x)) c++; }); return { name: sh.name, gbp: sh.gbp_shop_name || "", c }; })
    .filter(x => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 3);
  if (near.length > 0) {
    parts.push(`登録済みで近い店舗名: ${near.map(x => `「${x.name}」${x.gbp && x.gbp !== x.name ? `（GBP名: ${x.gbp}）` : ""}`).join(" ")}。B列をこの表記に完全一致させてください`);
  } else {
    parts.push("投稿対象の店舗に近い名前がありません。未登録・GBP未連携・解約済み・削除済みのいずれか（店舗情報管理／契約状態ページで確認）");
  }
  parts.push(`B列の値: 「${sheetName}」（${Array.from(sheetName).length}文字）`);
  return parts.join("。");
}

/**
 * Dropbox API呼び出し（429対策）。
 * 300店舗×3枚規模では list_folder / get_temporary_link を数百回叩くため、
 * Dropboxのレート制限（429 too_many_requests / Retry-After）に確実に当たる。
 * 以前は429をそのまま「写真なし」扱いにしていたので、店舗が黙って予約から抜け落ちていた。
 * Retry-After（無ければ2秒→4秒）待って最大3回まで再試行する。
 */
async function dropboxFetch(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, { cache: "no-store" as const, ...init });
  for (let attempt = 1; attempt <= 3 && res.status === 429; attempt++) {
    const retryAfter = Number(res.headers.get("Retry-After") || "");
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * attempt;
    console.warn(`[Dropbox] 429 rate limit: ${Math.round(waitMs / 1000)}秒待って再試行 (${attempt}/3) ${url.split("/").slice(-2).join("/")}`);
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 15000)));
    res = await fetch(url, { cache: "no-store" as const, ...init });
  }
  return res;
}


/**
 * 日付は一致するのに対応形式でないファイル（.arw/.heic/.webp 等）を拾って、「マッチ0件」の理由を具体的に返す。
 * 2026-08-28 羊八札幌本店: 写真投稿26-8-4 (1)〜(3).arw（SonyのRAW）で「マッチ0件・例: スクリーンショット…」としか出ず原因が分からなかった
 */
function explainNoDateMatch(where: string, files: { name: string; path: string }[], dateCompact: string, rootPathLower = ""): string {
  const link = (f: { name: string; path: string }) => { const u = dropboxWebUrl(rootPathLower, f.path); return u ? `${f.name} ${u}` : f.name; };
  const hasDate = (n: string) => { const i = n.indexOf(dateCompact); if (i === -1) return false; const c = n[i + dateCompact.length]; return !(c && /\d/.test(c)); };
  const unsupported = files.filter(f => hasDate(f.name) && !isSupportedMediaFile(f.name));
  if (unsupported.length > 0) {
    const exts = Array.from(new Set(unsupported.map(f => (f.name.match(/\.[^.]+$/)?.[0] || "(拡張子なし)").toLowerCase())));
    return `${where}に「${dateCompact}」のファイルは${unsupported.length}件ありますが、形式が ${exts.join(" ")} でGBPに投稿できません`
      + `（対応: 写真 JPG/PNG、動画 MP4/MOV）。JPGに書き出し直してください。該当: ${unsupported.slice(0, 3).map(link).join(" , ")}`;
  }
  const dated = files.filter(f => f.name.includes(dateCompact));
  if (dated.length > 0) {
    return `${where}に「${dateCompact}」を含むファイルはありますが投稿対象になりません（例: ${dated.slice(0, 3).map(link).join(" , ")}）。「写真投稿${dateCompact} (1).jpg」の形式にしてください`;
  }
  return `${where}（${files.length}件）に「写真投稿${dateCompact} (1).jpg」のような「${dateCompact}」付きファイルがありません。例: ${files.slice(0, 5).map(f => f.name).join(", ")}`;
}

/**
 * Dropbox共有リンクからフォルダ内のファイルをリストし、日付マッチする全写真のDLリンクを取得
 */
async function searchDropboxPhotosMultiple(folderUrl: string, dateCompact: string, shopName: string): Promise<{ items: MediaItem[]; debug: string }> {
  const dbxToken = await getDropboxAccessToken();
  if (!dbxToken) return { items: [], debug: "Dropboxトークン取得失敗" };

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
      const res = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder", {
        cache: "no-store" as const,
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
          const contRes = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
            cache: "no-store" as const,
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
        } catch (e: any) { console.error("[auto-post] Dropbox pagination error:", e?.message); break; }
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

      // サブフォルダを最大DROPBOX_MAX_DEPTH階層まで再帰展開（パスは共有ルートからの相対パス）
      // 例: 店舗/お客様共有/神戸牛しゃぶしゃぶ/横400縦300以下/4:3トリミング/写真.png のような深い配置に対応
      let visitedFolders = 0;
      const pendingFolders = root.folders.map((f: any) => ({
        // 共有リンクのlist_folderでは相対パスを使う必要がある
        // path_displayが返される場合もあるが、安全のため name ベースで組み立て
        relativePath: `/${f.name}`,
        depth: 1,
      }));
      while (pendingFolders.length > 0) {
        const sf = pendingFolders.shift()!;
        if (sf.depth > DROPBOX_MAX_DEPTH) continue;
        if (++visitedFolders > DROPBOX_MAX_FOLDERS) { debugSteps.push(`フォルダ数上限${DROPBOX_MAX_FOLDERS}到達で探索打ち切り`); break; }
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
        } catch (e: any) { console.error("[auto-post] subfolder expand error:", e?.message); }
      }
      debugSteps.push(`${files.length}件のファイル発見(フォルダ${root.folders.length}個+サブ展開)`);
    } catch (e: any) {
      debugSteps.push(`list_folder例外: ${e?.message}`);
    }

    if (files.length === 0) return { items: [], debug: `フォルダ内にファイルが0件 [${debugSteps.join(" → ")}] URL: ${shareUrl.slice(0, 80)}` };

    // 共有フォルダのルート絶対パスを取得（get_temporary_link用）
    let sharedRootPath = "";
    try {
      const metaRes = await dropboxFetch("https://api.dropboxapi.com/2/sharing/get_shared_link_metadata", {
        cache: "no-store" as const,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
        body: JSON.stringify({ url: shareUrl }),
        signal: AbortSignal.timeout(10000),
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        sharedRootPath = meta.path_lower || "";
      }
    } catch (e: any) { console.error("[auto-post] shared link metadata error:", e?.message); }

    // ファイル名にdateCompactを含む画像をフィルタ
    // "26-5-1"が"26-5-10"等にマッチしないよう、後続文字が数字でないことを確認
    const dateMatches = files.filter(f => {
      if (!isSupportedMediaFile(f.name)) return false;
      const idx = f.name.indexOf(dateCompact);
      if (idx === -1) return false;
      // dateCompactの直後の文字が数字ならfalse（"26-5-1"が"26-5-10"にマッチしないように）
      const nextChar = f.name[idx + dateCompact.length];
      if (nextChar && /\d/.test(nextChar)) return false;
      return true;
    });

    if (dateMatches.length === 0) {
      return { items: [], debug: explainNoDateMatch("F列のフォルダ", files, dateCompact, sharedRootPath) };
    }

    // 全マッチファイルのDLリンクを取得
    // 動画混在に対応するためURLとファイル名を対で持つ（Dropbox一時リンクは拡張子を含まない）
    const items: MediaItem[] = [];
    let dlDebug: string[] = [];



    for (const file of dateMatches.slice(0, 10)) {
      let got = false;

      // 方法1: get_temporary_link（パスをそのまま試行）
      try {
        const linkRes = await dropboxFetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
          cache: "no-store" as const,
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
          body: JSON.stringify({ path: file.path }),
          signal: AbortSignal.timeout(10000),
        });
        if (linkRes.ok) {
          const linkData = await linkRes.json();
          if (linkData.link) { items.push({ url: linkData.link, name: file.name, webUrl: dropboxWebUrl(sharedRootPath, file.path) }); got = true; }
        }
      } catch (e: any) { console.error("[auto-post] temp_link method1 error:", file.name, e?.message); }

      // 方法2: 共有ルートパス + 相対パスで再試行
      if (!got && sharedRootPath) {
        const absPath = file.path.startsWith(sharedRootPath)
          ? file.path
          : `${sharedRootPath}${file.path.startsWith("/") ? "" : "/"}${file.path}`;
        try {
          const linkRes2 = await dropboxFetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
            cache: "no-store" as const,
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ path: absPath }),
            signal: AbortSignal.timeout(10000),
          });
          if (linkRes2.ok) {
            const linkData2 = await linkRes2.json();
            if (linkData2.link) { items.push({ url: linkData2.link, name: file.name, webUrl: dropboxWebUrl(sharedRootPath, file.path) }); got = true; }
          }
        } catch (e: any) { console.error("[auto-post] temp_link method2 error:", file.name, e?.message); }
      }

      // 方法3: ファイル単体の共有リンクを新規作成
      if (!got) {
        const tryPath = sharedRootPath
          ? `${sharedRootPath}${file.path.startsWith("/") ? "" : "/"}${file.path}`
          : file.path;
        try {
          const shareRes = await dropboxFetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
            cache: "no-store" as const,
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ path: tryPath, settings: { requested_visibility: "public", access: "viewer" } }),
            signal: AbortSignal.timeout(10000),
          });
          const shareBody = await shareRes.json();
          const fileShareUrl = shareBody?.url || shareBody?.error?.shared_link_already_exists?.metadata?.url;
          if (fileShareUrl) {
            items.push({ url: fileShareUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/\?dl=0/, "?dl=1"), name: file.name, webUrl: dropboxWebUrl(sharedRootPath, file.path) });
            got = true;
          }
        } catch (e: any) { console.error("[auto-post] share_link method3 error:", file.name, e?.message); }
      }

      if (!got) dlDebug.push(`取得失敗: ${file.name}`);
    }

    const debugExtra = dlDebug.length > 0 ? ` [${dlDebug.join("; ")}]` : "";
    return { items, debug: items.length > 0 ? `${items.length}件取得（${dateMatches.length}件マッチ）${debugExtra}` : `${dateMatches.length}件マッチしたがDLリンク取得失敗${debugExtra}` };
  } catch (e: any) {
    return { items: [], debug: `例外: ${e?.message}` };
  }
}

// 後方互換: 1枚だけ返す旧インターフェース
async function searchDropboxPhotoWithDebug(folderUrl: string, dateCompact: string, shopName: string): Promise<{ url: string; debug: string }> {
  const result = await searchDropboxPhotosMultiple(folderUrl, dateCompact, shopName);
  return { url: result.items[0]?.url || "", debug: result.debug };
}

// おおもとDropboxフォルダ（全店舗の写真フォルダが入っている親フォルダ）
const DROPBOX_ROOT_FOLDER_URL = process.env.DROPBOX_ROOT_FOLDER_URL || "";

// おおもとフォルダのサブフォルダ一覧キャッシュ（TTL 10分、失敗時はキャッシュしない）
let cachedRootSubfolders: { data: { name: string; url: string }[]; ts: number } | null = null;
const ROOT_CACHE_TTL = 10 * 60 * 1000; // 10分

/**
 * おおもとDropboxフォルダのサブフォルダ一覧を取得（キャッシュあり）
 */
async function getRootSubfolders(dbxToken: string): Promise<{ name: string; url: string }[]> {
  if (cachedRootSubfolders && Date.now() - cachedRootSubfolders.ts < ROOT_CACHE_TTL) return cachedRootSubfolders.data;

  const shareUrl = DROPBOX_ROOT_FOLDER_URL.replace(/[&?]dl=\d/g, "").replace(/[&?]st=[^&]*/g, "").replace(/[?&]$/, "");

  try {
    let allEntries: any[] = [];
    const res = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder", {
      cache: "no-store" as const,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
      body: JSON.stringify({ path: "", shared_link: { url: shareUrl }, limit: 2000 }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`[Dropbox] Root folder list failed: ${res.status}`);
      return []; // 失敗時はキャッシュしない
    }
    const data = await res.json();
    allEntries = data.entries || [];
    let hasMore = data.has_more;
    let cursor = data.cursor;
    while (hasMore && cursor) {
      try {
        const contRes = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
          cache: "no-store" as const,
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
        } else break;
      } catch (e: any) { console.error("[auto-post] root folder pagination error:", e?.message); break; }
    }

    // フォルダのみ抽出し、共有リンクURLを生成
    const folders = allEntries
      .filter((e: any) => e[".tag"] === "folder")
      .map((e: any) => ({ name: e.name || "", url: "" }));

    console.log(`[Dropbox] Root subfolders: ${folders.length}件 (例: ${folders.slice(0, 5).map(f => f.name).join(", ")})`);
    cachedRootSubfolders = { data: folders, ts: Date.now() };
    return folders;
  } catch (e: any) {
    console.error(`[Dropbox] Root folder error: ${e?.message}`);
    return []; // 失敗時はキャッシュしない
  }
}

/**
 * おおもとフォルダから店舗名に一致するサブフォルダを探し、その中の写真を検索
 */
async function searchDropboxByShopName(shopName: string, dateCompact: string): Promise<{ items: MediaItem[]; debug: string }> {
  const dbxToken = await getDropboxAccessToken();
  if (!dbxToken) return { items: [], debug: "Dropboxトークン取得失敗" };

  const subfolders = await getRootSubfolders(dbxToken);
  if (subfolders.length === 0) return { items: [], debug: "おおもとフォルダのサブフォルダ0件" };

  // 店舗名でフォルダを検索。
  // おおもとフォルダの店舗フォルダは「202 札幌ジンギスカン 羊座 札幌」のように先頭に管理番号が付く運用
  // （dropbox-chubby-system の新構成、2026-08-26 全216店舗移行）。以前は正規化完全一致だけだったため、
  // F列にURLが無い店舗は番号付きフォルダと一致せず「写真なし」で17店舗が抜けた（2026-08-28）。
  // 1) 完全一致 → 2) 先頭番号を除いて完全一致 → 3) 片方がもう片方を含む（候補が1件のときだけ）の順で探す
  const stripNo = (n: string) => n.replace(/^\d+[\s\u3000_\-.．]*/, "");
  const target = normName(shopName);
  let matched = subfolders.find(f => matchShopName(f.name, shopName))
    || subfolders.find(f => normName(stripNo(f.name)) === target);
  if (!matched && target.length >= 3) {
    const contains = subfolders.filter(f => {
      const n = normName(stripNo(f.name));
      return n.length >= 3 && (n.includes(target) || target.includes(n));
    });
    if (contains.length === 1) matched = contains[0];
  }
  if (!matched) {
    // 近い名前を出して「フォルダ名の何が違うか」を画面で分かるようにする（3文字の共通部分で近さを数える）
    const grams = (n: string) => { const g = new Set<string>(); for (let i = 0; i + 3 <= n.length; i++) g.add(n.slice(i, i + 3)); return g; };
    const tg = grams(target);
    const near = subfolders
      .map(f => { const fg = grams(normName(stripNo(f.name))); let c = 0; tg.forEach(x => { if (fg.has(x)) c++; }); return { name: f.name, c }; })
      .filter(x => x.c > 0).sort((a, b) => b.c - a.c).slice(0, 3).map(x => `「${x.name}」`);
    return {
      items: [],
      debug: `Dropboxのおおもとフォルダ（${subfolders.length}件）に店舗名「${shopName}」と同じ名前のフォルダがありません`
        + (near.length > 0 ? `。近い名前: ${near.join(" ")}（店舗名と一致するようフォルダ名かシートB列を直してください）` : "。フォルダ名の先頭の番号は無視して照合しています"),
    };
  }

  // マッチしたサブフォルダを、おおもとフォルダの共有リンク経由でlist_folder
  const shareUrl = DROPBOX_ROOT_FOLDER_URL.replace(/[&?]dl=\d/g, "").replace(/[&?]st=[^&]*/g, "").replace(/[?&]$/, "");
  const relativePath = `/${matched.name}`;

  try {
    let files: { name: string; path: string }[] = [];
    const res = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder", {
      cache: "no-store" as const,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
      body: JSON.stringify({ path: relativePath, shared_link: { url: shareUrl }, limit: 2000 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { items: [], debug: `フォルダ「${matched.name}」のlist失敗: HTTP${res.status} ${body.slice(0, 80)}` };
    }
    const data = await res.json();
    let allEntries = data.entries || [];
    let hasMore = data.has_more;
    let cursor = data.cursor;
    while (hasMore && cursor) {
      try {
        const contRes = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
          cache: "no-store" as const,
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
        } else break;
      } catch { break; }
    }

    // サブフォルダを最大DROPBOX_MAX_DEPTH階層まで幅優先で再帰展開
    // （店舗/お客様共有/◯◯/横400縦300以下/4:3トリミング/ のような深い配置に対応）
    const toFile = (e: any) => ({ name: e.name || "", path: e.path_display || e.path_lower || "" });
    files.push(...allEntries.filter((e: any) => e[".tag"] === "file").map(toFile));
    const pendingFolders: { relativePath: string; depth: number }[] = allEntries
      .filter((e: any) => e[".tag"] === "folder")
      .map((e: any) => ({ relativePath: `${relativePath}/${e.name}`, depth: 1 }));
    let visitedFolders = 0;
    while (pendingFolders.length > 0) {
      const sf = pendingFolders.shift()!;
      if (sf.depth > DROPBOX_MAX_DEPTH) continue;
      if (++visitedFolders > DROPBOX_MAX_FOLDERS) { console.warn(`[auto-post] フォルダ数上限${DROPBOX_MAX_FOLDERS}到達: ${matched.name}`); break; }
      try {
        const subRes = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder", {
          cache: "no-store" as const,
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
          body: JSON.stringify({ path: sf.relativePath, shared_link: { url: shareUrl }, limit: 2000 }),
          signal: AbortSignal.timeout(15000),
        });
        if (!subRes.ok) continue;
        const subData = await subRes.json();
        let subEntries = subData.entries || [];
        let subMore = subData.has_more;
        let subCursor = subData.cursor;
        while (subMore && subCursor) {
          const contRes = await dropboxFetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
            cache: "no-store" as const,
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ cursor: subCursor }),
            signal: AbortSignal.timeout(15000),
          });
          if (!contRes.ok) break;
          const contData = await contRes.json();
          subEntries = subEntries.concat(contData.entries || []);
          subMore = contData.has_more;
          subCursor = contData.cursor;
        }
        files.push(...subEntries.filter((e: any) => e[".tag"] === "file").map(toFile));
        for (const f of subEntries.filter((e: any) => e[".tag"] === "folder")) {
          pendingFolders.push({ relativePath: `${sf.relativePath}/${f.name}`, depth: sf.depth + 1 });
        }
      } catch (e: any) { console.error("[auto-post] subfolder list error:", e?.message); }
    }

    // get_shared_link_metadata でルートパスを取得
    let sharedRootPath = "";
    try {
      const metaRes = await dropboxFetch("https://api.dropboxapi.com/2/sharing/get_shared_link_metadata", {
        cache: "no-store" as const,
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
        body: JSON.stringify({ url: shareUrl }),
        signal: AbortSignal.timeout(10000),
      });
      if (metaRes.ok) {
        const meta = await metaRes.json();
        sharedRootPath = meta.path_lower || "";
      }
    } catch (e: any) { console.error("[auto-post] shop shared link metadata error:", e?.message); }

    // 日付マッチする画像ファイルをフィルタ
    const dateMatches = files.filter(f => {
      if (!isSupportedMediaFile(f.name)) return false;
      const idx = f.name.indexOf(dateCompact);
      if (idx === -1) return false;
      const nextChar = f.name[idx + dateCompact.length];
      if (nextChar && /\d/.test(nextChar)) return false;
      return true;
    });

    if (dateMatches.length === 0) {
      return { items: [], debug: explainNoDateMatch(`フォルダ「${matched.name}」`, files, dateCompact, sharedRootPath) };
    }



    // DLリンク取得（方法1-3を既存ロジックと同様に）
    const items: MediaItem[] = [];
    const dlDebug: string[] = [];

    for (const file of dateMatches.slice(0, 10)) {
      let got = false;

      // 方法1: get_temporary_link（path_displayそのまま）
      try {
        const linkRes = await dropboxFetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
          cache: "no-store" as const,
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
          body: JSON.stringify({ path: file.path }),
          signal: AbortSignal.timeout(10000),
        });
        if (linkRes.ok) {
          const d = await linkRes.json();
          if (d.link) { items.push({ url: d.link, name: file.name, webUrl: dropboxWebUrl(sharedRootPath, file.path) }); got = true; }
        }
      } catch (e: any) { console.error("[auto-post] shop temp_link method1 error:", file.name, e?.message); }

      // 方法2: ルートパス + 相対パスで再試行
      if (!got && sharedRootPath) {
        const absPath = file.path.startsWith(sharedRootPath) ? file.path : `${sharedRootPath}${file.path.startsWith("/") ? "" : "/"}${file.path}`;
        try {
          const linkRes2 = await dropboxFetch("https://api.dropboxapi.com/2/files/get_temporary_link", {
            cache: "no-store" as const,
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ path: absPath }),
            signal: AbortSignal.timeout(10000),
          });
          if (linkRes2.ok) {
            const d2 = await linkRes2.json();
            if (d2.link) { items.push({ url: d2.link, name: file.name, webUrl: dropboxWebUrl(sharedRootPath, file.path) }); got = true; }
          }
        } catch (e: any) { console.error("[auto-post] shop temp_link method2 error:", file.name, e?.message); }
      }

      // 方法3: 共有リンク作成
      if (!got) {
        const tryPath = sharedRootPath ? `${sharedRootPath}${file.path.startsWith("/") ? "" : "/"}${file.path}` : file.path;
        try {
          const shareRes = await dropboxFetch("https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings", {
            cache: "no-store" as const,
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${dbxToken}` },
            body: JSON.stringify({ path: tryPath, settings: { requested_visibility: "public", access: "viewer" } }),
            signal: AbortSignal.timeout(10000),
          });
          const shareBody = await shareRes.json();
          const fileShareUrl = shareBody?.url || shareBody?.error?.shared_link_already_exists?.metadata?.url;
          if (fileShareUrl) {
            items.push({ url: fileShareUrl.replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/\?dl=0/, "?dl=1"), name: file.name, webUrl: dropboxWebUrl(sharedRootPath, file.path) });
            got = true;
          }
        } catch (e: any) { console.error("[auto-post] shop share_link method3 error:", file.name, e?.message); }
      }

      if (!got) dlDebug.push(`取得失敗: ${file.name}`);
    }

    const debugExtra = dlDebug.length > 0 ? ` [${dlDebug.join("; ")}]` : "";
    return { items, debug: items.length > 0 ? `${matched.name}→${items.length}件取得（${dateMatches.length}件マッチ）${debugExtra}` : `${matched.name}→${dateMatches.length}件マッチしたがDLリンク取得失敗${debugExtra}` };
  } catch (e: any) {
    return { items: [], debug: `例外: ${e?.message}` };
  }
}

/** 許可ドメインリスト（SSRF防止） */
const ALLOWED_PHOTO_HOSTS = ["dropbox.com", "www.dropbox.com", "dl.dropboxusercontent.com", "dl.dropbox.com", "lh3.googleusercontent.com"];

function isAllowedPhotoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return ALLOWED_PHOTO_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
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
export const POST = withAudit("シート自動投稿", "EXTERNAL_OP", async (request, ctx) => {
  const body = await request.json();
  const { sheetId, targetDate, dryRun, topicType, batchOffset, batchSize, filterShopName, filterShopNames, scheduleMode, scheduleAt, checkOnly } = body as {
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
    checkOnly?: boolean; // scheduleMode時: 事前チェックのみ（Dropbox検索・店舗照合・警告判定まで行い、Storage保存とDB登録はしない）
  };
  const isPhotoOnly = topicType === "PHOTO";

  // 監査ログ: プレビュー / 予約登録 / 即時実行を操作名で区別
  if (dryRun) ctx.actionOverride = "シート自動投稿プレビュー";
  else if (scheduleMode && checkOnly) ctx.actionOverride = "シート自動投稿事前チェック";
  else if (scheduleMode) ctx.actionOverride = "シート自動投稿予約登録";

  // リクエストごとにDropboxサブフォルダキャッシュをリセット
  cachedRootSubfolders = null;
  cachedFallbackTokens = null;

  if (!sheetId || !targetDate) {
    return NextResponse.json({ error: "sheetIdとtargetDateが必要です" }, { status: 400 });
  }

  // filterShopNames が「空配列」で来たら絞り込みなし＝全店舗として動いてしまう。
  // 呼び出し側が店舗を絞ったつもりで名前の解決に失敗したケースなので、全店舗に投稿せず必ず落とす。
  if (Array.isArray(filterShopNames) && filterShopNames.length === 0) {
    return NextResponse.json(
      { error: "投稿先の店舗が空で送られました（全店舗への投稿を防ぐため中止しました）。店舗を選び直してください" },
      { status: 400 },
    );
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

  // スプレッドシート読み取り用のOAuthトークンを取得
  const sheetAccessToken = await getOAuthToken();

  // 対象タブを読み込み
  const tabs = ["投稿用シート", "報告必須店舗 投稿用シート", "WHITE 系列 投稿用シート"];
  const allMatches: { shopName: string; summary: string; photoUrl: string; ctaUrl: string; tab: string; rawPhotoCell: string; rawDateCell: string; photoDebug: string; topicType: string; offerTitle: string; offerStartDate: any; offerEndDate: any; photoIndex?: number; mediaFileName?: string; mediaFormat?: GbpMediaFormat; mediaWebUrl?: string }[] = [];
  const pendingPhotoSearch: { index: number; photoCell: string; shopName: string }[] = [];

  // タブのCSV取得は並列（3タブ直列だとクライアントの待ち時間に乗ってしまう）。
  // 行の処理はタブ順のまま行う: 写真投稿の「同一店舗は最初の1行のみ」がタブ順に依存するため。
  const csvByTab = await Promise.all(tabs.map(async (tab) => {
    try {
      // 1回だけ再試行する。取得できなかったタブの行は丸ごと処理対象外になり、
      // 「対象の店舗が0件」「一部の店舗だけ投稿されない」という気づきにくい欠落になるため
      let csvText = await fetchSheetCsv(sheetId, tab, sheetAccessToken);
      if (!csvText) csvText = await fetchSheetCsv(sheetId, tab, sheetAccessToken);
      return { tab, csvText };
    } catch (e) {
      console.error(`[auto-post] Tab "${tab}" fetch error:`, e);
      return { tab, csvText: null as string | null };
    }
  }));

  // 取得できなかったタブは処理対象から丸ごと抜ける。黙って0件・一部欠落にせず必ず返す
  const failedTabs = csvByTab.filter(c => !c.csvText).map(c => c.tab);

  for (const { tab, csvText } of csvByTab) {
    try {
      if (!csvText) continue;

      const rows = parseCSV(csvText);

      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const aCell = (row[0] || "").trim(); // A列（index 0）投稿タイプ判定
        const shopName = (row[1] || "").trim(); // B列（index 1）
        const postText = (row[2] || "").trim(); // C列（index 2）
        const dateCell = (row[4] || "").trim(); // E列（index 4）
        const photoCell = (row[5] || "").trim(); // F列（index 5）
        const offerTitle = (row[7] || "").trim(); // H列（index 7）特典用の題名
        // J列（index 9）CTAボタンURL。
        // 写真のみ投稿（PHOTO）はCTAを一切使わないので、ここで必ず空にする。
        // 以前は写真投稿でもJ列のURLを読んで生存確認していたため、食べログ等がHEADを400/403で弾くと
        // 写真も本文も正常なのに「CTAリンク異常」で保留になっていた（2026-08-21 que キュー等4件）。
        // 下流（生存確認・DB保存・即時投稿のcallToAction）は全てこの値を見るので、ここで遮断すれば再発しない。
        const ctaUrl = isPhotoOnly ? "" : (row[9] || "").trim();

        // WHITE系列タブ: A列に「特典投稿」→OFFER、それ以外→STANDARD
        const isOffer = tab === "WHITE 系列 投稿用シート" && aCell.includes("特典投稿");
        const rowTopicType = isPhotoOnly ? "PHOTO" : isOffer ? "OFFER" : "STANDARD";

        // OFFER: 開始日=投稿日、終了日=月末
        const offerStartDate = isOffer ? { year: dateObj.getFullYear(), month: dateObj.getMonth() + 1, day: dateObj.getDate() } : null;
        const offerEndDate = isOffer ? { year: dateObj.getFullYear(), month: dateObj.getMonth() + 1, day: new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0).getDate() } : null;

        if (!shopName) continue;
        if (!isPhotoOnly && !postText) continue; // 写真のみ投稿ではテキスト不要

        if (isPhotoOnly) {
          // 写真投稿: E列日付は見ない。B列店舗名で処理（F列空でもおおもとフォルダから検索可能）
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
          const match = filterShopNames.some(fn => matchShopName(shopName, fn));
          if (!match) continue;
        } else if (filterShopName && !matchShopName(shopName, filterShopName)) continue;

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

  // バッチ分割は「シートの行（=店舗）」単位で行う。
  // 以前は写真検索で見つかった2枚目以降を allMatches の末尾に push していたため、
  // 全店舗の2〜3枚目が最終バッチに固まり、そのバッチがタイムアウトすると
  // 「12店舗すべて1枚しか投稿されない」状態になっていた（2026-08-21）。
  // さらに各バッチのリクエストで全店舗分のDropbox検索をやり直していたのがタイムアウトの原因。
  // → 今のバッチ範囲の行だけ写真検索し、2枚目以降は親行の直後に並べて同じリクエスト内で登録する。
  const rowCount = allMatches.length; // プレビューの件数と一致する安定した母数
  const offset = batchOffset || 0;
  const size = batchSize || rowCount; // 未指定時は全件
  const extrasByRow = new Map<number, any[]>(); // 行index → 2枚目以降のマッチ

  // Dropbox写真検索を5件ずつバッチ実行（レート制限対策）。対象は今回のバッチ範囲の行のみ
  const photoSearchTargets = dryRun ? [] : pendingPhotoSearch.filter(p => p.index >= offset && p.index < offset + size);
  if (photoSearchTargets.length > 0) {
    const PHOTO_BATCH = 5;
    for (let bi = 0; bi < photoSearchTargets.length; bi += PHOTO_BATCH) {
      const batch = photoSearchTargets.slice(bi, bi + PHOTO_BATCH);
      await Promise.all(batch.map(async (p) => {
      const match = allMatches[p.index];

      let mediaItems: MediaItem[] = [];
      let photoDebug = "";
      // 写真投稿: "26-5-1" = 月内の投稿番号、通常投稿: "260412" = 日付
      const fileNameDate = isPhotoOnly
        ? `${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${photoPostNumber}`
        : dateYymmdd;
      // F列にDropbox URLがある場合: 直接そのフォルダを検索
      if (p.photoCell && p.photoCell.includes("dropbox.com")) {
        const result = await searchDropboxPhotosMultiple(p.photoCell.trim(), fileNameDate, p.shopName);
        mediaItems = result.items;
        photoDebug = result.debug;
      }
      // F列にURL形式の文字列がある場合: 正規表現で抽出（SSRF防止: 許可ドメインのみ）
      if (mediaItems.length === 0 && p.photoCell) {
        const urls = (p.photoCell.match(/https?:\/\/[^\s,"]+/g) || []).filter(isAllowedPhotoUrl);
        const dated = urls.filter((u: string) => u.includes(fileNameDate));
        // このURLは拡張子を含むのでURL自体から形式を判定できる
        mediaItems = dated.map((u: string) => ({ url: convertDropboxUrl(u), name: u }));
      }
      // フォールバック: おおもとDropboxフォルダから店舗名で検索
      if (mediaItems.length === 0) {
        const rootResult = await searchDropboxByShopName(p.shopName, fileNameDate);
        mediaItems = rootResult.items;
        photoDebug = rootResult.debug;
      }
      if (mediaItems.length === 0 && !photoDebug) photoDebug = "URLから写真・動画を抽出できません";

      const total = mediaItems.length;
      const label = (i: number) => `${detectMediaFormat(mediaItems[i].name) === "VIDEO" ? "動画" : "写真"}${i + 1}/${total}`;
      const applyItem = (target: any, i: number) => {
        target.photoUrl = mediaItems[i].url;
        target.mediaFileName = mediaItems[i].name;
        target.mediaWebUrl = mediaItems[i].webUrl || "";
        target.mediaFormat = detectMediaFormat(mediaItems[i].name) || undefined;
        target.photoDebug = label(i);
      };

      if (total === 0) {
        match.photoUrl = "";
        match.photoDebug = photoDebug;
      } else if (isPhotoOnly || total > 1) {
        // 1件目をこのマッチに、残りは別マッチとして追加（1ファイル=1投稿）
        applyItem(match, 0);
        const extras: any[] = [];
        for (let pi = 1; pi < total; pi++) {
          const extra: any = { ...match, summary: "", photoIndex: pi };
          applyItem(extra, pi);
          extras.push(extra);
        }
        if (extras.length > 0) extrasByRow.set(p.index, extras);
      } else {
        applyItem(match, 0);
      }
    }));
    }
  }

  if (allMatches.length === 0) {
    // デバッグ: なぜ0件か情報を返す
    // 取得済みのCSVを使い回す（ここで再取得すると0件のときだけ倍の時間がかかる）
    const tabResults: string[] = csvByTab.map(({ tab, csvText }) => {
      if (!csvText) return `${tab}: 取得できず（HTTPエラー / HTMLが返った / タイムアウト）`;
      const rows = parseCSV(csvText);
      const shopNames = rows.slice(1, 6).map(r => (r[1] || "").trim()).filter(Boolean);
      const photoCells = rows.slice(1, 6).map(r => (r[5] || "").slice(0, 30)).filter(Boolean);
      return `${tab}: ${rows.length}行, B列例:[${shopNames.join(",")}], F列例:[${photoCells.join(",")}]`;
    });
    ctx.detail = `${targetDate}: 該当データ0件`;
    return NextResponse.json({
      matches: 0,
      message: `${targetDate}に該当する投稿データがありません`,
      failedTabs,
      debug: { isPhotoOnly, topicType, dateCompact, photoPostNumber, tabResults, filterShopName, filterShopNames, failedTabs },
    });
  }

  if (dryRun) {
    ctx.detail = `${targetDate}: プレビュー${allMatches.length}件${isPhotoOnly ? "（写真投稿）" : ""}`;
    // プレビュー時はバッチ情報も返す
    const bs = batchSize || 10;
    const totalBatches = Math.ceil(allMatches.length / bs);
    const photoFilePattern = isPhotoOnly
      ? `写真投稿${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${photoPostNumber}`
      : undefined;
    return NextResponse.json({
      matches: allMatches.length,
      failedTabs,
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

  // バッチ分割: 今回の範囲の行＋その行の2枚目以降（親の直後に並べる）。同一店舗の全枚数が同じリクエストで登録される
  const batchMatches: typeof allMatches = [];
  for (let ri = offset; ri < Math.min(offset + size, rowCount); ri++) {
    batchMatches.push(allMatches[ri]);
    for (const extra of extrasByRow.get(ri) || []) batchMatches.push(extra);
  }

  const supabase = getSupabase();
  // 解約済み（cancelled_at）・削除済み（deleted_at）は投稿対象から外す。
  // 以前は gbp_location_name の有無だけで引いていたため、「全店舗」で走らせると解約店舗のGBPにも投稿し得た
  // （2026-08-28 時点で解約72件・削除4件）。画面の店舗一覧（Go API）と同じ条件に揃える
  const { data: shops } = await supabase.from("shops")
    .select("id, name, gbp_location_name, gbp_shop_name")
    .not("gbp_location_name", "is", null)
    .is("cancelled_at", null)
    .is("deleted_at", null);

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
  } catch (e: any) {
    console.error("[auto-post] fixed_messages取得失敗:", e?.message);
  }

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
    // 登録できなかった行の理由。以前はレスポンスにしか残らず、画面を閉じると
    // 「なぜこの店舗が予約されなかったか」を後から追えなかった（2026-08-28: 17店舗が消えたが理由不明）
    const skips: { shop_name: string; reason: string; detail: string | null }[] = [];
    const recordSkip = (shopName: string, reason: string, detail?: string) => {
      schedResults.push({ shopName, status: reason, detail: detail || undefined });
      skips.push({ shop_name: shopName, reason, detail: detail || null });
      schedErrors++;
    };

    // --- フェーズ1: 店舗解決・写真URL変換・警告判定（並列） ---
    // 300店舗×3枚規模では写真URL変換（Dropbox DL→Storage UP、動画は数十MB）が直列だと
    // 1バッチ（10店舗=30ファイル）で2分近くかかり、300秒上限に近づく。4並列で走らせる
    type Prepared = { match: (typeof batchMatches)[number]; shop: { id: string; name: string } | null; warnings: string[]; skip?: { reason: string; detail?: string } };
    const prepare = async (match: (typeof batchMatches)[number]): Promise<Prepared> => {
      if (isPhotoOnly && !match.photoUrl) {
        // スキップ理由を原因別のラベルにする（一覧で理由別に集計され、対処が分かる）
        const d = match.photoDebug || "";
        const reason = d.includes("GBPに投稿できません") ? "写真の形式が非対応（スキップ）"
          : d.includes("同じ名前のフォルダがありません") ? "Dropboxに店舗フォルダなし（スキップ）"
          : d.includes("付きファイルがありません") || d.includes("投稿対象になりません") ? "対象日の写真ファイルなし（スキップ）"
          : d.includes("Dropboxトークン") || d.includes("list失敗") ? "Dropbox接続エラー（スキップ）"
          : "写真なし（スキップ）";
        return { match, shop: null, warnings: [], skip: { reason, detail: d } };
      }
      if (!isPhotoOnly && !match.summary) {
        return { match, shop: null, warnings: [], skip: { reason: "本文なし（スキップ）" } };
      }
      const shop = (shops || []).find((s) =>
        matchShopName(s.name, match.shopName) || matchShopName(s.gbp_shop_name || "", match.shopName)
      );
      if (!shop) {
        return { match, shop: null, warnings: [], skip: { reason: "店舗未登録（スキップ）", detail: explainShopMismatch(match.shopName, shops || []) } };
      }

      // 差し込み文字列を投稿文に結合（shop_idまたはshop_nameでマッチ）
      const fixedMsg = getFixedMsg(shop.id, shop.name);
      if (!isPhotoOnly && match.summary && fixedMsg) {
        match.summary = `${match.summary}\n\n${fixedMsg}`;
      }

      // === 予約投稿バリデーション ===
      const warnings: string[] = [];

      // 0. Dropbox一時URL（get_temporary_link・有効期限4時間）を安定URLに変換してから保存
      //    実行は予約時刻（翌日以降もあり得る）のため、一時URLのままだと実行時に失効している
      //    ※Storage上の画像は実行完了まで必要なので、ここではcleanupImageを呼ばないこと
      if (match.photoUrl && match.photoUrl.includes("dropbox") && !checkOnly) {
        const { resolveMediaUrl } = await import("@/lib/image-proxy");
        // ファイル名を渡して拡張子を保つ。実行時はこのURLの拡張子で PHOTO / VIDEO を判定する
        const resolved = await resolveMediaUrl(
          match.photoUrl,
          `sched-${shop.id}-${crypto.randomUUID().slice(0, 8)}`,
          match.mediaFileName || "",
        );
        if (resolved.url) {
          match.photoUrl = resolved.url;
        } else if (isPhotoOnly) {
          return {
            match, shop, warnings,
            skip: { reason: /大きすぎ/.test(resolved.error || "") ? "動画サイズ超過（スキップ）" : "写真URL変換失敗（スキップ）", detail: `${resolved.error || "原因不明"}${match.mediaFileName ? ` / ファイル: ${match.mediaFileName}` : ""}${match.mediaWebUrl ? ` ${match.mediaWebUrl}` : ""}` },
          };
        } else {
          warnings.push(`写真URL変換失敗（写真なしで保存されます）: ${resolved.error || "原因不明"}`);
          match.photoUrl = "";
        }
      }

      // 1. CTAリンク生存確認（J列にURLがある場合）。写真のみ投稿はCTA無関係なので絶対に走らせない（二重ガード）
      if (!isPhotoOnly && match.ctaUrl) {
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
      return { match, shop, warnings };
    };

    const PREPARE_CONCURRENCY = 4;
    const prepared: Prepared[] = [];
    for (let i = 0; i < batchMatches.length; i += PREPARE_CONCURRENCY) {
      const chunk = batchMatches.slice(i, i + PREPARE_CONCURRENCY);
      const settled = await Promise.allSettled(chunk.map(prepare));
      settled.forEach((r, idx) => {
        if (r.status === "fulfilled") prepared.push(r.value);
        else prepared.push({ match: chunk[idx], shop: null, warnings: [], skip: { reason: `エラー: ${r.reason?.message || "不明"}` } });
      });
    }

    // --- 事前チェックのみ: 登録せずに「登録できる／できない理由」を返す ---
    // 300店舗を予約する前に、写真が見つからない店舗・未登録店舗を洗い出すため。
    // 以前は本登録して初めてスキップが分かり、しかも理由が残らなかった
    if (checkOnly) {
      for (const { match, shop, warnings, skip } of prepared) {
        if (skip || !shop) {
          schedResults.push({ shopName: match.shopName, status: skip?.reason || "エラー: 店舗解決不能", detail: skip?.detail, check: "ng" });
          schedErrors++;
        } else if (warnings.length > 0) {
          schedResults.push({ shopName: match.shopName, status: "登録可能（保留になります）", warnings, detail: match.photoDebug, check: "hold" });
          scheduled++;
        } else {
          schedResults.push({ shopName: match.shopName, status: "登録可能", detail: match.photoDebug, check: "ok" });
          scheduled++;
        }
      }
      ctx.detail = `${targetDate}: 事前チェック 登録可能${scheduled}件/不可${schedErrors}件（マッチ${allMatches.length}件）`;
      return NextResponse.json({
        matches: allMatches.length, failedTabs,
        posted: scheduled, errors: schedErrors, results: schedResults,
        batchOffset: offset, batchSize: size, batchProcessed: batchMatches.length,
        hasMore: offset + size < rowCount, nextOffset: offset + size,
        scheduleMode: true, checkOnly: true, scheduledAt: scheduledTime,
      });
    }

    // --- フェーズ2: DB登録（直列。重複チェック→insertの順序を守る） ---
    for (const { match, shop, warnings, skip } of prepared) {
      if (skip || !shop) {
        recordSkip(match.shopName, skip?.reason || "エラー: 店舗解決不能", skip?.detail);
        continue;
      }

      // 警告ありなら保留（on_hold）、なしなら予約（pending）
      const postStatus = warnings.length > 0 ? "on_hold" : "pending";

      // 同一店舗の複数枚写真は2枚目以降を1分ずつずらす
      // （同一店舗・同一時刻の重複チェックに写真2枚目以降が誤ってかからないようにするため。
      //   再実行時は同じずらし時刻同士が一致するので二重登録防止はそのまま機能する）
      const matchTime = match.photoIndex
        ? new Date(new Date(scheduledTime).getTime() + match.photoIndex * 60000).toISOString()
        : scheduledTime;

      try {
        // 重複チェック: 同一店舗・同一予約時刻の投稿が既に存在する場合はスキップ
        const { data: existing } = await supabase.from("scheduled_posts")
          .select("id").eq("shop_id", shop.id).eq("scheduled_at", matchTime)
          .in("status", ["pending", "on_hold", "processing"]).limit(1);
        if (existing && existing.length > 0) {
          schedResults.push({ shopName: match.shopName, status: "重複スキップ（同一時刻の予約が既存）" });
          continue;
        }

        const { error: insertErr } = await supabase.from("scheduled_posts").insert({
          id: crypto.randomUUID(),
          shop_id: shop.id,
          shop_name: shop.name,
          // 写真のみ投稿は本文を投稿に使わないため保存しない（予約一覧で本文が投稿されると誤解されるのを防ぐ）
          summary: isPhotoOnly ? "" : (match.summary || ""),
          topic_type: match.topicType || "STANDARD",
          photo_url: match.photoUrl || null,
          action_type: match.ctaUrl ? "LEARN_MORE" : null,
          action_url: match.ctaUrl || null,
          scheduled_at: matchTime,
          status: postStatus,
          offer_title: match.offerTitle || null,
          offer_start_date: match.offerStartDate || null,
          offer_end_date: match.offerEndDate || null,
        });
        if (insertErr) {
          recordSkip(match.shopName, `DB保存エラー: ${insertErr.message}`);
        } else if (warnings.length > 0) {
          schedResults.push({ shopName: match.shopName, status: `保留（要確認）`, warnings, savedSummary: isPhotoOnly ? "" : (match.summary || "").slice(0, 80), savedCtaUrl: match.ctaUrl || "" });
          schedErrors++;
        } else {
          schedResults.push({ shopName: match.shopName, status: "予約登録成功", warnings: [], savedSummary: isPhotoOnly ? "" : (match.summary || "").slice(0, 80), savedCtaUrl: match.ctaUrl || "" });
          scheduled++;
        }
      } catch (e: any) {
        recordSkip(match.shopName, `エラー: ${e?.message}`);
      }
    }

    // スキップ理由を永続化（auto_post_skips）。失敗しても予約登録自体は成立しているので落とさない
    if (skips.length > 0) {
      try {
        const { error: skipErr } = await supabase.from("auto_post_skips").insert(skips.map((k) => ({
          id: crypto.randomUUID(),
          scheduled_at: scheduledTime,
          target_date: targetDate,
          topic_type: topicType || "STANDARD",
          shop_name: k.shop_name,
          reason: k.reason,
          detail: k.detail,
        })));
        if (skipErr) console.error("[auto-post] auto_post_skips 保存失敗:", skipErr.message);
      } catch (e: any) {
        console.error("[auto-post] auto_post_skips 保存例外:", e?.message);
      }
    }

    ctx.detail = `${targetDate}: 予約登録${scheduled}件/エラー${schedErrors}件（マッチ${allMatches.length}件、予約時刻: ${scheduledTime}）`;
    return NextResponse.json({
      matches: allMatches.length,
      failedTabs,
      posted: scheduled, errors: schedErrors, results: schedResults,
      skipped: skips.length,
      batchOffset: offset, batchSize: size, batchProcessed: batchMatches.length,
      hasMore: offset + size < rowCount, nextOffset: offset + size,
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
   try {
    // 店舗名でマッチ
    const shop = (shops || []).find((s) =>
      matchShopName(s.name, match.shopName) || matchShopName(s.gbp_shop_name || "", match.shopName)
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
        // Dropbox一時URLをSupabase Storage経由の安定URLに変換
        const { resolveMediaUrl, cleanupImage } = await import("@/lib/image-proxy");
        const postId = `auto-${shop.id}-${photoPostNumber}-${Date.now()}`;
        let stableUrl = match.photoUrl;
        let resolvedBytes = 0;
        if (match.photoUrl.includes("dropbox")) {
          const resolved = await resolveMediaUrl(match.photoUrl, postId, match.mediaFileName || "");
          if (resolved.url) {
            stableUrl = resolved.url;
            resolvedBytes = resolved.bytes || 0;
          } else {
            // 理由を出さないと「なぜ失敗したか」が画面から分からない（サイズ超過が多い）
            results.push({
              shopName: match.shopName,
              status: "写真URL変換失敗",
              detail: `${resolved.error || "原因不明"}${match.mediaFileName ? ` / ファイル: ${match.mediaFileName}` : ""}${match.mediaWebUrl ? ` ${match.mediaWebUrl}` : ""}`,
              summary: match.photoDebug,
            });
            errors++;
            continue;
          }
        }

        const fmt = mediaFormatOf(match, stableUrl);
        const { res: mediaRes, text: mediaText } = await gbpFetchWithTokenFallback(
          `${GBP_API_BASE}/${locationName}/media`,
          { body: JSON.stringify({ mediaFormat: fmt, sourceUrl: stableUrl, locationAssociation: { category: "ADDITIONAL" } }) },
          accessToken,
        );
        const mediaBody = parseJson(mediaText);
        if (mediaRes.ok && mediaBody.name) {
          results.push({ shopName: match.shopName, status: fmt === "VIDEO" ? "動画投稿成功" : "写真投稿成功", gbpMediaName: mediaBody.name, googleUrl: mediaBody.googleUrl, summary: `${fmt === "VIDEO" ? "動画" : "写真"}: ${match.photoDebug}`, sourceUrl: stableUrl });
          posted++;
          // 投稿ログに保存（管理画面に表示するため）
          try {
            await supabase.from("post_logs").insert({
              id: crypto.randomUUID(), shop_id: shop.id, shop_name: shop.name,
              summary: "", topic_type: "PHOTO",
              // 動画は googleUrl が動画本体なので、一覧の<img>用にサムネイルを優先して保存する
              media_url: (fmt === "VIDEO" ? (mediaBody.thumbnailUrl || mediaBody.googleUrl) : mediaBody.googleUrl) || stableUrl,
              gbp_post_name: mediaBody.name,
            });
          } catch (e: any) {
            console.error(`[auto-post] post_logs記録失敗(写真): ${shop.name}`, e?.message);
          }
          cleanupImage(postId).catch(() => {});
        } else {
          // GBPの400は message が "Request contains an invalid argument." だけで、本当の理由は details 側に入る。
          // ファイル名・サイズも併記しないと「同じ店の1枚目は成功、2枚目は失敗」の原因が追えない（2026-08-21 ワイロ）
          // 日本語の原因を先頭に、Googleの原文は後ろに残す（画面は「｜」の先頭だけ強調表示）
          const sizeNote = resolvedBytes ? `（${(resolvedBytes / 1024 / 1024).toFixed(2)}MB）` : "";
          const errDetail = `${explainGbpError("GBP Media API", mediaRes.status, JSON.stringify(mediaBody), { isMedia: true })}｜ファイル: ${match.mediaFileName || "?"}${sizeNote}${match.mediaWebUrl ? ` ${match.mediaWebUrl}` : ""}`;
          results.push({ shopName: match.shopName, status: `写真エラー(${mediaRes.status})`, detail: errDetail, summary: match.photoDebug, sourceUrl: stableUrl });
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
        const { res: mediaRes } = await gbpFetchWithTokenFallback(
          `${GBP_API_BASE}/${locationName}/media`,
          { body: JSON.stringify({ mediaFormat: mediaFormatOf(match, directUrl), sourceUrl: directUrl, locationAssociation: { category: "ADDITIONAL" } }) },
          accessToken,
        );
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
      postBody.media = [{ mediaFormat: mediaFormatOf(match, directUrl), sourceUrl: directUrl }];
    }

    try {
      let { res, text: resText } = await gbpFetchWithTokenFallback(
        `${GBP_API_BASE}/${locationName}/localPosts`,
        { body: JSON.stringify(postBody) },
        accessToken,
      );

      // 写真付きで失敗したら写真なしでリトライ（topicType・OFFER情報は維持する）
      if (!res.ok && match.photoUrl) {
        const retryBody: any = { summary: trimmedSummary, topicType: match.topicType || "STANDARD", languageCode: "ja" };
        if (match.topicType === "OFFER" && match.offerTitle) {
          retryBody.event = { title: match.offerTitle, schedule: { startDate: match.offerStartDate, endDate: match.offerEndDate } };
        }
        if (match.ctaUrl) retryBody.callToAction = { actionType: "LEARN_MORE", url: match.ctaUrl };
        ({ res, text: resText } = await gbpFetchWithTokenFallback(
          `${GBP_API_BASE}/${locationName}/localPosts`,
          { body: JSON.stringify(retryBody) },
          accessToken,
        ));
      }

      if (res.ok) {
        const result = parseJson(resText);
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
            // 別トークンで投稿された場合、既定トークンのGETは404になるのでここもフォールバックする
            const { res: verifyRes } = await gbpFetchWithTokenFallback(
              `${GBP_API_BASE}/${result.name}`,
              { method: "GET", timeoutMs: 10000 },
              accessToken,
            );
            verified = verifyRes.ok;
          } catch (e: any) {
            console.warn(`[auto-post] 投稿確認GET失敗: ${result.name}`, e?.message);
          }
          results.push({ shopName: match.shopName, status: verified ? "投稿成功（確認済み）" : "投稿成功（未確認）", summary: match.summary.slice(0, 30), gbpPostName: result.name, searchUrl: result.searchUrl, verified });
          posted++;
        } else {
          // HTTP 200だがGBP投稿が作成されていない
          console.error(`[auto-post] GBP returned 200 but no post name:`, JSON.stringify(result).slice(0, 500));
          results.push({ shopName: match.shopName, status: "GBP応答異常（投稿ID無し）", detail: JSON.stringify(result).slice(0, 300), summary: match.summary.slice(0, 30), locationName });
          errors++;
        }
      } else {
        console.error(`[auto-post] GBP API error: ${res.status}`, resText.slice(0, 500));
        results.push({ shopName: match.shopName, status: `GBPエラー(${res.status})`, detail: resText.slice(0, 300), summary: match.summary.slice(0, 30), photoUrl: match.photoUrl, locationName });
        errors++;
      }
    } catch (e: any) {
      results.push({ shopName: match.shopName, status: `エラー: ${e?.message}`, summary: match.summary.slice(0, 30) });
      errors++;
    }
   } catch (outerErr: any) {
     results.push({ shopName: match.shopName || "不明", status: `予期しないエラー: ${outerErr?.message?.slice(0, 100)}` });
     errors++;
   }
  }

  const photoFilePattern = isPhotoOnly
    ? `写真投稿${String(dateObj.getFullYear()).slice(2)}-${dateObj.getMonth() + 1}-${photoPostNumber}`
    : undefined;

  ctx.detail = `${targetDate}: 投稿${posted}件/エラー${errors}件（マッチ${allMatches.length}件、バッチ${offset}〜${offset + batchMatches.length}）`;
  return NextResponse.json({
    matches: allMatches.length,
    failedTabs,
    posted, errors, results,
    batchOffset: offset,
    batchSize: size,
    batchProcessed: batchMatches.length,
    hasMore: offset + size < rowCount,
    nextOffset: offset + size,
    photoPostNumber: isPhotoOnly ? photoPostNumber : undefined,
    photoFilePattern,
  });
});
