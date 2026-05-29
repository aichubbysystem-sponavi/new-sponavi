import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY || SUPABASE_ANON_KEY);
}

type GridPoint = {
  lat: number;
  lng: number;
  rank: number;
  row: number;
  col: number;
};

/**
 * 距離（チェビシェフ距離）を計算
 * center は (3, 3)（0-indexed）
 */
function chebyshevDistance(row: number, col: number, center: number): number {
  return Math.max(Math.abs(row - center), Math.abs(col - center));
}

/**
 * 指定範囲のランダム整数を生成 [min, max]
 */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * centerRank を元に 7x7 グリッドを生成する
 * - 距離0（中心）: centerRank
 * - 距離1（隣接8セル）: centerRank + 1〜3
 * - 距離2（次の16セル）: centerRank + 3〜7
 * - 距離3（外周24セル）: centerRank + 7〜15
 * - 結果 > 100 は圏外（0）
 */
function generateGrid(centerRank: number): GridPoint[] {
  const GRID_SIZE = 7;
  const CENTER = 3; // 0-indexed
  const grid: GridPoint[] = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const dist = chebyshevDistance(row, col, CENTER);

      let rank: number;
      if (dist === 0) {
        rank = centerRank;
      } else if (dist === 1) {
        rank = centerRank + randInt(1, 3);
      } else if (dist === 2) {
        rank = centerRank + randInt(3, 7);
      } else {
        // dist === 3
        rank = centerRank + randInt(7, 15);
      }

      // 100位超え → 圏外
      if (rank > 100) rank = 0;

      grid.push({ lat: 0, lng: 0, rank, row, col });
    }
  }

  return grid;
}

/**
 * POST /api/report/grid-ranking-generate
 * 単一地点の順位から 7x7 グリッドを自動生成し Supabase に保存する
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopId, shopName, keyword, centerRank } = body as {
    shopId: string;
    shopName: string;
    keyword: string;
    centerRank: number;
  };

  if (!shopId || !shopName || !keyword || centerRank == null) {
    return NextResponse.json(
      { error: "shopId, shopName, keyword, centerRank が必要です" },
      { status: 400 }
    );
  }

  if (typeof centerRank !== "number" || centerRank < 0) {
    return NextResponse.json(
      { error: "centerRank は 0 以上の数値が必要です" },
      { status: 400 }
    );
  }

  const results = generateGrid(centerRank);
  const supabase = getSupabase();

  const { error: upsertErr } = await supabase
    .from("grid_ranking_overrides")
    .upsert(
      {
        id: crypto.randomUUID(),
        shop_id: shopId,
        shop_name: shopName,
        keyword,
        grid_size: 7,
        results,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_name,keyword" }
    );

  if (upsertErr) {
    return NextResponse.json(
      { success: false, error: upsertErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, results });
}

/**
 * GET /api/report/grid-ranking-generate
 * ?shopName=xxx — 指定店舗の全グリッドオーバーライドを返す
 */
export async function GET(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const shopName = request.nextUrl.searchParams.get("shopName");

  if (!shopName) {
    return NextResponse.json(
      { error: "shopName クエリパラメータが必要です" },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("grid_ranking_overrides")
    .select("keyword, grid_size, results, updated_at")
    .eq("shop_name", shopName)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const formatted = (data || []).map((row) => ({
    keyword: row.keyword,
    gridSize: row.grid_size,
    results: row.results,
    updatedAt: row.updated_at,
  }));

  return NextResponse.json(formatted);
}

/**
 * PUT /api/report/grid-ranking-generate
 * 単一セルの順位を更新する
 * Body: { shopName, keyword, row, col, newRank }
 */
export async function PUT(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  const body = await request.json();
  const { shopName, keyword, row, col, newRank } = body as {
    shopName: string;
    keyword: string;
    row: number;
    col: number;
    newRank: number;
  };

  if (!shopName || !keyword || row == null || col == null || newRank == null) {
    return NextResponse.json(
      { error: "shopName, keyword, row, col, newRank が必要です" },
      { status: 400 }
    );
  }

  const supabase = getSupabase();

  // 既存レコードを取得
  const { data: existing, error: fetchErr } = await supabase
    .from("grid_ranking_overrides")
    .select("id, results")
    .eq("shop_name", shopName)
    .eq("keyword", keyword)
    .single();

  if (fetchErr || !existing) {
    return NextResponse.json(
      { error: "指定されたキーワードのグリッドが見つかりません" },
      { status: 404 }
    );
  }

  const results: GridPoint[] = existing.results as GridPoint[];

  // 対象セルを更新
  const targetIndex = results.findIndex((p) => p.row === row && p.col === col);
  if (targetIndex === -1) {
    return NextResponse.json(
      { error: `row=${row}, col=${col} のセルが見つかりません` },
      { status: 404 }
    );
  }

  results[targetIndex] = { ...results[targetIndex], rank: newRank };

  const { error: updateErr } = await supabase
    .from("grid_ranking_overrides")
    .update({
      results,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  if (updateErr) {
    return NextResponse.json(
      { success: false, error: updateErr.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, results });
}
