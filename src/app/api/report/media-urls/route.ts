import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/supabase";
import { getOAuthToken } from "@/lib/gbp-token";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GBP_API_BASE = "https://mybusiness.googleapis.com/v4";

/**
 * POST /api/report/media-urls
 * GBPメディアのリソース名から、今この瞬間に有効な画像URLを取り直す。
 *
 * 背景: GBP Media API が返す googleUrl / thumbnailUrl は永続URLではない
 * （公式ドキュメントに "This URL is not static since it may change over time"）。
 * post_logs.media_url に保存した googleUrl は数日で失効し、lh3.googleusercontent.com が
 * 403 を返すようになる（2026-08-09 実測: 保存済みURLは全パターン403、取り直すと200）。
 * 画像そのものは生きているので、リソース名から都度取り直せば表示できる。
 *
 * 注意: 取り直したURLに =s400 等のサイズサフィックスを付けると 400 になる。そのまま使うこと。
 */

// 失効するURLなので長くは持てない。同じ画面の再描画でGBPを叩き直さない程度の短いTTL
const TTL_MS = 30 * 60 * 1000;
const MAX_NAMES = 200;
const CONCURRENCY = 8;
const CACHE_LIMIT = 5000;

type Entry = { url: string | null; thumb: string | null; at: number };
// Vercelのインスタンス内キャッシュ。インスタンスをまたぐと消えるが、
// 1画面ぶんの解決を何度も繰り返さないためには十分
const cache = new Map<string, Entry>();

// accounts/{id}/locations/{id}/media/{id} 以外は弾く。
// localPosts のリソース名や任意の文字列でGBPのURLを組み立てさせない
const MEDIA_NAME_RE = /^accounts\/[A-Za-z0-9_-]+\/locations\/[A-Za-z0-9_-]+\/media\/[A-Za-z0-9_-]+$/;

function pruneCache() {
  if (cache.size <= CACHE_LIMIT) return;
  // 古い順に半分捨てる
  const entries = Array.from(cache.entries()).sort((a, b) => a[1].at - b[1].at);
  for (const [k] of entries.slice(0, Math.floor(entries.length / 2))) cache.delete(k);
}

type Resolved = { name: string; url: string | null; thumb: string | null };
type Failed = { name: string; status: number; detail?: string };

async function resolveOne(
  name: string,
  token: string,
): Promise<{ ok: true; value: Resolved } | { ok: false; value: Failed }> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return { ok: true, value: { name, url: hit.url, thumb: hit.thumb } };
  }

  try {
    const res = await fetch(`${GBP_API_BASE}/${name}`, {
      // 失効URLを掴み続けないよう必ずno-store
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, value: { name, status: res.status, detail: detail.slice(0, 200) } };
    }
    const body = await res.json().catch(() => ({} as any));
    const entry: Entry = {
      url: body.googleUrl || null,
      thumb: body.thumbnailUrl || null,
      at: Date.now(),
    };
    if (!entry.url && !entry.thumb) {
      return { ok: false, value: { name, status: 200, detail: "googleUrl/thumbnailUrlが空" } };
    }
    cache.set(name, entry);
    pruneCache();
    return { ok: true, value: { name, url: entry.url, thumb: entry.thumb } };
  } catch (e: any) {
    return { ok: false, value: { name, status: 0, detail: e?.message?.slice(0, 200) } };
  }
}

export async function POST(request: NextRequest) {
  // 締め切りはリクエスト開始からの経過で測る。
  // トークン取得（Go API 20秒 + DBリフレッシュ15秒）のあとに測り始めると
  // 締め切り45秒 + 個別タイムアウト10秒が上乗せされ、maxDuration(60秒)を超えて
  // 関数ごと落ちる＝全件失敗になる
  const startedAt = Date.now();

  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid || !auth.sub) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({} as any));
  const raw: unknown = body?.names;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "names（配列）が必要です" }, { status: 400 });
  }

  // 重複除去 + 形式チェック
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const n of raw) {
    if (typeof n !== "string" || seen.has(n)) continue;
    seen.add(n);
    if (MEDIA_NAME_RE.test(n)) valid.push(n);
    else invalid.push(n);
  }

  // 上限超過は黙って切らずに件数を返す（呼び出し側で分割して再送する）
  const truncated = Math.max(0, valid.length - MAX_NAMES);
  const targets = valid.slice(0, MAX_NAMES);

  if (targets.length === 0) {
    return NextResponse.json({ urls: {}, failed: [], invalid, truncated });
  }

  const token = await getOAuthToken();
  if (!token) {
    return NextResponse.json({ error: "GBPのOAuthトークンを取得できませんでした" }, { status: 500 });
  }

  const urls: Record<string, { url: string | null; thumb: string | null }> = {};
  const failed: Failed[] = [];

  // GBPが遅いと maxDuration を超えて関数ごと落ち、全件が失敗扱いになる。
  // 締め切りを過ぎたら新しいリクエストを出さず、取れた分だけ返して残りは未処理として報告する。
  // 個別タイムアウト10秒ぶんの余裕を残して maxDuration(60秒) 内に必ず返す
  const deadline = startedAt + 45_000;
  let cursor = 0;
  const skipped: string[] = [];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (cursor < targets.length) {
        const name = targets[cursor++];
        if (Date.now() > deadline) { skipped.push(name); continue; }
        const r = await resolveOne(name, token);
        if (r.ok) urls[r.value.name] = { url: r.value.url, thumb: r.value.thumb };
        else failed.push(r.value);
      }
    }),
  );

  if (failed.length > 0) {
    console.error(`[media-urls] ${failed.length}/${targets.length}件の解決に失敗:`, failed.slice(0, 5));
  }
  if (skipped.length > 0) {
    console.error(`[media-urls] 時間切れで${skipped.length}件を未処理のまま返した`);
  }

  return NextResponse.json({ urls, failed, invalid, truncated, skipped });
}
