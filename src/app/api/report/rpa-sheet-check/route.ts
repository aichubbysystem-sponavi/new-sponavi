/**
 * GET /api/report/rpa-sheet-check
 * 口コミ(RPA)シートとDBを突き合わせ、書き込み前に確認すべき情報を返す。
 *
 * 確認できること:
 *  1. シートA列の店舗がシステム(shops)に存在するか
 *  2. シートの7月値(AS/AT)とDBの現在値が同じ定義か
 *     → 近ければGoogleマップ掲載値で入力されている＝同じ値を書けば整合する
 *     → 乖離が大きいなら別の定義なので、書き込む値を見直す必要がある
 *  3. 8月列(AU/AV)に既に値が入っていないか（上書き事故の防止）
 *
 * このAPIは読み取り専用。シートへの書き込みは行わない。
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SHEET_ID = "1p6n4MpDCvh0v6svQjWb4oZFINhT70idfdSAXEeYM_dc";
const GID = "806898743";

/** 列位置(0始まり)。AS=44/AT=45/AU=46/AV=47。行1の月ヘッダーで検算済み */
const COL_JUL_RATING = 44;
const COL_JUL_COUNT = 45;
const COL_AUG_RATING = 46;
const COL_AUG_COUNT = 47;

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const norm = (s: string) => (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();

export async function GET(request: NextRequest) {
  const r = await requireRole(request, ["president", "executive", "manager"]);
  if (r.error) return r.error;

  // 1. シート取得
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}&range=A1:AV2000`;
  let rows: string[][];
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `シートを取得できません（HTTP ${res.status}）` }, { status: 502 });
    }
    const text = await res.text();
    if (text.includes("<!DOCTYPE") || text.includes("<html")) {
      return NextResponse.json({ error: "シートがHTMLを返しました（共有設定を確認してください）" }, { status: 502 });
    }
    rows = parseCSV(text);
  } catch (e: any) {
    return NextResponse.json({ error: `シート取得エラー: ${e?.message || "不明"}` }, { status: 502 });
  }

  // 月ヘッダーで列位置を検算（シートに列が挿入されたら気づけるようにする）
  const headerAug = (rows[0]?.[COL_AUG_RATING] || "").trim();
  const headerJul = (rows[0]?.[COL_JUL_RATING] || "").trim();

  const sheet: { name: string; julRating: string; julCount: string; augRating: string; augCount: string }[] = [];
  for (let i = 2; i < rows.length; i++) {
    const name = (rows[i][0] || "").trim();
    if (!name) continue;
    sheet.push({
      name,
      julRating: (rows[i][COL_JUL_RATING] || "").trim(),
      julCount: (rows[i][COL_JUL_COUNT] || "").trim(),
      augRating: (rows[i][COL_AUG_RATING] || "").trim(),
      augCount: (rows[i][COL_AUG_COUNT] || "").trim(),
    });
  }

  // 2. DB取得（PostgRESTの1000行上限を避けてページング）
  const sb = getSupabase();
  const shops: { name: string; rating: number | null; review_count: number | null }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("shops")
      .select("name, rating, review_count")
      .order("name")
      .range(from, from + 999);
    if (error) {
      return NextResponse.json({ error: "店舗の取得に失敗しました", _error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    shops.push(...(data as any[]));
    if (data.length < 1000) break;
  }
  const db = new Map(shops.map((s) => [norm(s.name), s]));

  // 3. 照合
  const unmatched: string[] = [];
  const alreadyFilled: string[] = [];
  const noRating: string[] = [];
  const compare: { name: string; julRating: number; dbRating: number; ratingDiff: number; julCount: number | null; dbCount: number | null }[] = [];
  let matched = 0;

  for (const s of sheet) {
    if (s.augRating || s.augCount) alreadyFilled.push(s.name);
    const d = db.get(norm(s.name));
    if (!d) { unmatched.push(s.name); continue; }
    matched++;
    if (!d.rating || d.rating <= 0) { noRating.push(s.name); continue; }
    const jr = parseFloat(s.julRating);
    if (!Number.isFinite(jr)) continue;
    const jc = parseInt(s.julCount);
    compare.push({
      name: s.name,
      julRating: jr,
      dbRating: d.rating,
      ratingDiff: Math.round(Math.abs(jr - d.rating) * 100) / 100,
      julCount: Number.isFinite(jc) ? jc : null,
      dbCount: d.review_count ?? null,
    });
  }

  const within01 = compare.filter((c) => c.ratingDiff <= 0.1).length;
  const sortedDiff = compare.map((c) => c.ratingDiff).sort((a, b) => a - b);
  const median = sortedDiff.length > 0 ? sortedDiff[Math.floor(sortedDiff.length / 2)] : null;

  return NextResponse.json({
    header: { julColumn: headerJul, augColumn: headerAug },
    summary: {
      sheetShops: sheet.length,
      dbShops: shops.length,
      matched,
      unmatched: unmatched.length,
      noRatingInDb: noRating.length,
      augAlreadyFilled: alreadyFilled.length,
      compared: compare.length,
      within01,
      within01Pct: compare.length > 0 ? Math.round((within01 / compare.length) * 100) : 0,
      medianRatingDiff: median,
    },
    // 乖離が大きい順（定義が違う場合ここに偏りが出る）
    topDiffs: compare.sort((a, b) => b.ratingDiff - a.ratingDiff).slice(0, 15),
    unmatchedShops: unmatched.slice(0, 50),
    noRatingShops: noRating.slice(0, 30),
    alreadyFilledShops: alreadyFilled.slice(0, 30),
  });
}
