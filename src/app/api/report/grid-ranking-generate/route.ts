import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

type GridPoint = { lat: number; lng: number; rank: number; row: number; col: number };

function chebyshevDistance(row: number, col: number, center: number): number {
  return Math.max(Math.abs(row - center), Math.abs(col - center));
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateGrid(centerRank: number): GridPoint[] {
  centerRank = Math.round(centerRank);
  const GRID_SIZE = 7;
  const CENTER = 3;
  const grid: GridPoint[] = [];
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const dist = chebyshevDistance(row, col, CENTER);
      let rank: number;
      if (dist === 0) rank = centerRank;
      else if (dist === 1) rank = centerRank + randInt(1, 3);
      else if (dist === 2) rank = centerRank + randInt(3, 7);
      else rank = centerRank + randInt(7, 15);
      if (rank > 100 || centerRank <= 0) rank = 0;
      grid.push({ lat: 0, lng: 0, rank, row, col });
    }
  }
  return grid;
}

/**
 * 3×3実測値から7×7グリッドを生成（6月〜の新方式用）
 * centerPoints: 3×3の9地点の実測値（row:1-3, col:1-3 の中央エリア）
 */
function generateGridFrom3x3(centerPoints: { row: number; col: number; rank: number }[]): GridPoint[] {
  const GRID_SIZE = 7;
  const CENTER = 3;
  const grid: GridPoint[] = [];
  const centerMap = new Map(centerPoints.map(p => [`${p.row},${p.col}`, p.rank]));

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const dist = chebyshevDistance(row, col, CENTER);
      let rank: number;
      const key = `${row},${col}`;
      if (centerMap.has(key)) {
        // 3×3実測エリア内 → 実測値をそのまま使用
        rank = centerMap.get(key)!;
      } else {
        // 外周 → 最も近い実測値を基準に加算
        let nearestRank = centerMap.get(`${CENTER},${CENTER}`) || 0;
        let minDist = Infinity;
        for (const cp of centerPoints) {
          const d = Math.max(Math.abs(row - cp.row), Math.abs(col - cp.col));
          if (d < minDist) { minDist = d; nearestRank = cp.rank; }
        }
        if (dist === 2) rank = nearestRank + randInt(3, 7);
        else rank = nearestRank + randInt(7, 15);
      }
      if (rank > 100 || rank <= 0) rank = 0;
      grid.push({ lat: 0, lng: 0, rank, row, col });
    }
  }
  return grid;
}

/**
 * シートの最新月で最も順位の良いキーワードを自動選定
 */
function selectBestKeyword(datasets: { word: string; ranks: (number | null)[] }[]): string | null {
  let bestWord: string | null = null;
  let bestRank = Infinity;
  for (const ds of datasets) {
    // 最新月（配列末尾）の値を取得
    const lastRank = ds.ranks[ds.ranks.length - 1];
    if (lastRank !== null && lastRank > 0 && lastRank < bestRank) {
      bestRank = lastRank;
      bestWord = ds.word;
    }
  }
  return bestWord;
}

/**
 * POST /api/report/grid-ranking-generate
 * 単月生成: { shopName, keyword, month, centerRank }
 * 一括生成: { shopName, batch: [{ keyword, month, centerRank }] }
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const supabase = getSupabase();

  // 3×3実測→7×7推定モード
  if (body.useFrom3x3 && body.centerPoints) {
    const { shopId, shopName, keyword, month, centerPoints } = body;
    if (!shopName || !keyword || !month) {
      return NextResponse.json({ error: "shopName, keyword, month が必要です" }, { status: 400 });
    }
    const results = generateGridFrom3x3(centerPoints);
    // overridesにも保存
    await supabase.from("grid_ranking_overrides")
      .delete().eq("shop_name", shopName).eq("keyword", keyword).eq("month", month);
    await supabase.from("grid_ranking_overrides").insert({
      id: crypto.randomUUID(),
      shop_id: shopId || "",
      shop_name: shopName,
      keyword,
      month,
      grid_size: 7,
      results,
      updated_at: new Date().toISOString(),
    });
    return NextResponse.json({ success: true, results });
  }

  // 一括生成モード
  if (body.batch && Array.isArray(body.batch)) {
    const shopName = body.shopName as string;
    const shopId = body.shopId as string || "";
    if (!shopName) return NextResponse.json({ error: "shopName が必要です" }, { status: 400 });

    // 既存overridesを取得（手動編集済みのものは保持する）
    const { data: existing } = await supabase.from("grid_ranking_overrides")
      .select("keyword, month")
      .eq("shop_name", shopName);
    const existingKeys = new Set((existing || []).map((e: any) => `${e.keyword}::${e.month}`));

    // 既存にないもののみ新規生成（手動編集済みデータを保護）
    const newRows = body.batch
      .filter((item: { keyword: string; month: string; centerRank: number }) => !existingKeys.has(`${item.keyword}::${item.month}`))
      .map((item: { keyword: string; month: string; centerRank: number }) => ({
        id: crypto.randomUUID(),
        shop_id: shopId,
        shop_name: shopName,
        keyword: item.keyword,
        month: item.month,
        grid_size: 7,
        results: generateGrid(item.centerRank),
        updated_at: new Date().toISOString(),
      }));

    // 10件ずつバッチinsert（既存データは変更しない）
    let inserted = 0;
    const errors: string[] = [];
    for (let i = 0; i < newRows.length; i += 10) {
      const chunk = newRows.slice(i, i + 10);
      const { error } = await supabase.from("grid_ranking_overrides").insert(chunk);
      if (error) {
        console.error(`[grid-generate] batch insert error at ${i}:`, error.message);
        errors.push(error.message);
      } else {
        inserted += chunk.length;
      }
    }
    const skipped = body.batch.length - newRows.length;
    return NextResponse.json({ success: true, count: inserted, skipped, errors: errors.length > 0 ? errors : undefined });
  }

  // 単月生成モード
  const { shopId, shopName, keyword, month, centerRank } = body;
  if (!shopName || !keyword || !month || centerRank == null) {
    return NextResponse.json({ error: "shopName, keyword, month, centerRank が必要です" }, { status: 400 });
  }

  const results = generateGrid(centerRank);
  await supabase.from("grid_ranking_overrides")
    .delete().eq("shop_name", shopName).eq("keyword", keyword).eq("month", month);
  const { error } = await supabase.from("grid_ranking_overrides").insert({
    id: crypto.randomUUID(),
    shop_id: shopId || "",
    shop_name: shopName,
    keyword,
    month,
    grid_size: 7,
    results,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, results });
}

/**
 * GET /api/report/grid-ranking-generate?shopName=xxx
 * 指定店舗の全overridesを返す
 */
export async function GET(request: NextRequest) {
  const shopName = request.nextUrl.searchParams.get("shopName");
  if (!shopName) return NextResponse.json({ error: "shopName が必要です" }, { status: 400 });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("grid_ranking_overrides")
    .select("keyword, month, grid_size, results, updated_at")
    .eq("shop_name", shopName)
    .order("month", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data || []);
}

/**
 * PUT /api/report/grid-ranking-generate
 * 単一セルの順位を更新: { shopName, keyword, month, row, col, newRank }
 */
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { shopName, keyword, month, row, col, newRank } = body;
  if (!shopName || !keyword || !month || row == null || col == null || newRank == null) {
    return NextResponse.json({ error: "shopName, keyword, month, row, col, newRank が必要です" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: existing, error: fetchErr } = await supabase
    .from("grid_ranking_overrides")
    .select("id, results")
    .eq("shop_name", shopName).eq("keyword", keyword).eq("month", month)
    .single();
  if (fetchErr || !existing) return NextResponse.json({ error: "グリッドが見つかりません" }, { status: 404 });

  const results: GridPoint[] = existing.results as GridPoint[];
  const idx = results.findIndex(p => p.row === row && p.col === col);
  if (idx === -1) return NextResponse.json({ error: "セルが見つかりません" }, { status: 404 });

  results[idx] = { ...results[idx], rank: newRank };
  const { error } = await supabase.from("grid_ranking_overrides")
    .update({ results, updated_at: new Date().toISOString() }).eq("id", existing.id);
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true, results });
}

/**
 * DELETE /api/report/grid-ranking-generate
 * { shopName, keyword, month } or { shopName } (全削除)
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { shopName, keyword, month } = body;
  if (!shopName) return NextResponse.json({ error: "shopName が必要です" }, { status: 400 });

  const supabase = getSupabase();
  let query = supabase.from("grid_ranking_overrides").delete().eq("shop_name", shopName);
  if (keyword) query = query.eq("keyword", keyword);
  if (month) query = query.eq("month", month);
  const { error } = await query;
  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
