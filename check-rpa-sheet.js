/**
 * 口コミ(RPA)シートとDBの照合（読み取りのみ・書き込みは一切しない）
 *
 * 目的:
 *  1. シートのA列370店舗が、システム(shops)に存在するか
 *  2. シートの7月値(AS/AT)とDBの現在値が同じ性質のものか
 *     → 近ければ同じ定義（Googleマップ掲載値）で入力されている
 *     → 大きく違うなら別の定義なので、書き込む値を見直す必要がある
 *  3. 8月列(AU/AV)が本当に空か
 *
 * 使い方:
 *   node check-rpa-sheet.js
 *
 * ※シートは公開CSVで読む。DBはデプロイ済みAPIから取得するため
 *   環境変数 SN_TOKEN にログイン後のアクセストークンを入れて実行する。
 *     SN_TOKEN=xxx node check-rpa-sheet.js
 *   トークンはブラウザのDevTools > Application > Local Storage の
 *   sb-*-auth-token から access_token を取得できる。
 */

const SHEET_ID = "1p6n4MpDCvh0v6svQjWb4oZFINhT70idfdSAXEeYM_dc";
const GID = "806898743";
const API_BASE = process.env.SN_API_BASE || "https://new-spotlight-navigator.com";
const TOKEN = process.env.SN_TOKEN || "";

/** 列番号(0始まり) → 列名。AU=46, AV=47 */
const COL = { JUL_RATING: 44, JUL_COUNT: 45, AUG_RATING: 46, AUG_COUNT: 47 }; // AS,AT,AU,AV

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
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

const norm = (s) => (s || "").normalize("NFKC").replace(/[\s　]+/g, "").toLowerCase();

async function main() {
  if (!TOKEN) {
    console.error("SN_TOKEN が未設定です。");
    console.error("ブラウザのDevTools > Application > Local Storage から");
    console.error("sb-*-auth-token の access_token をコピーして、");
    console.error("  SN_TOKEN=<token> node check-rpa-sheet.js");
    console.error("のように実行してください。");
    process.exit(1);
  }

  // 1. シート読み込み
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${GID}&range=A1:AV2000`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) { console.error("シート取得失敗:", res.status); process.exit(1); }
  const rows = parseCSV(await res.text());
  const sheet = [];
  for (let i = 2; i < rows.length; i++) {
    const name = (rows[i][0] || "").trim();
    if (!name) continue;
    sheet.push({
      row: i + 1,
      name,
      julRating: (rows[i][COL.JUL_RATING] || "").trim(),
      julCount: (rows[i][COL.JUL_COUNT] || "").trim(),
      augRating: (rows[i][COL.AUG_RATING] || "").trim(),
      augCount: (rows[i][COL.AUG_COUNT] || "").trim(),
    });
  }

  // 2. DB読み込み
  const api = await fetch(`${API_BASE}/api/report/shop-ratings`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!api.ok) {
    console.error("API取得失敗:", api.status, await api.text().catch(() => ""));
    process.exit(1);
  }
  const { shops, summary } = await api.json();
  const db = new Map(shops.map((s) => [norm(s.name), s]));

  // 3. 照合
  let matched = 0, unmatched = 0, augFilled = 0;
  const diffs = [];
  const missing = [];
  for (const s of sheet) {
    if (s.augRating || s.augCount) augFilled++;
    const d = db.get(norm(s.name));
    if (!d) { unmatched++; missing.push(s.name); continue; }
    matched++;
    const jr = parseFloat(s.julRating), jc = parseInt(s.julCount);
    if (Number.isFinite(jr) && d.rating) {
      const dr = Math.abs(jr - d.rating);
      const dc = Number.isFinite(jc) && d.review_count ? d.review_count - jc : null;
      diffs.push({ name: s.name, 七月評価: jr, DB評価: d.rating, 評価差: +dr.toFixed(2), 七月件数: jc, DB件数: d.review_count, 件数差: dc });
    }
  }

  console.log("=== シート ===");
  console.log(`  店舗数: ${sheet.length}`);
  console.log(`  8月(AU/AV)に既に値がある行: ${augFilled}`);
  console.log("=== DB ===");
  console.log(`  全店舗: ${summary.total} / 評価あり: ${summary.withRating} / 評価なし: ${summary.withoutRating}`);
  console.log("=== 照合 ===");
  console.log(`  DBに存在: ${matched}`);
  console.log(`  DBに無い: ${unmatched}`);

  // 7月値とDB値の乖離（同じ定義かの判断材料）
  if (diffs.length > 0) {
    const rd = diffs.map((d) => d.評価差).sort((a, b) => a - b);
    const med = rd[Math.floor(rd.length / 2)];
    const same = diffs.filter((d) => d.評価差 <= 0.1).length;
    console.log("=== 7月値 vs DB現在値（同じ定義かの判断）===");
    console.log(`  比較できた店舗: ${diffs.length}`);
    console.log(`  評価差 0.1以内: ${same}件（${Math.round((same / diffs.length) * 100)}%）`);
    console.log(`  評価差の中央値: ${med}`);
    console.log("  ※7月値とDB現在値が近ければ同じ定義。件数はひと月ぶん増えるのが自然");
    console.log("  乖離が大きい上位10件:");
    diffs.sort((a, b) => b.評価差 - a.評価差).slice(0, 10)
      .forEach((d) => console.log(`    ${d.name}: 7月 ${d.七月評価}/${d.七月件数}件 → DB ${d.DB評価}/${d.DB件数}件`));
  }

  if (missing.length > 0) {
    console.log("=== DBに無い店舗（先頭20件）===");
    missing.slice(0, 20).forEach((n) => console.log("   ", n));
    if (missing.length > 20) console.log(`    ...他${missing.length - 20}件`);
  }

  console.log("\n※このスクリプトは読み取りのみです。シートへの書き込みは行いません。");
}

main().catch((e) => { console.error("Fatal:", e.message); process.exit(1); });
