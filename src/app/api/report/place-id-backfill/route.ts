/**
 * POST /api/report/place-id-backfill
 * 未取得店舗の gbp_place_id を一括取得する（SKU竹→梅移行の前提整備）
 * body: { limit?: number }（1回の呼び出しで処理する店舗数。既定10・最大20）
 *
 * 背景: 計測中の「店名完全一致でID自動保存」は、DB店名の装飾
 * （例:「patty rôti -パティロティ-」）がGoogleの表示名と一致せず
 * ほぼ発動していなかった（2026-07-29時点で605店舗中2店舗のみ）。
 * このAPIはText Search（Pro ¥4.8/店・一度きり）で店舗を検索し、
 * 「店舗座標から150m以内の最寄り結果」または「表示名の完全一致」で
 * place_id を特定して shops.gbp_place_id に保存する。
 * 曖昧な場合は保存せずスキップとして報告する（誤ID保存は誤順位に直結するため）。
 *
 * クライアント側は remaining が 0 になるまで繰り返し呼び出す。
 */
import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { withAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const GCP_API_KEY = process.env.GCP_API_KEY || "";

/** 2点間の概算距離（メートル） */
function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * 111320;
  const dLng = (lng2 - lng1) * 111320 * Math.cos((lat1 * Math.PI) / 180);
  return Math.sqrt(dLat * dLat + dLng * dLng);
}

export const POST = withAudit("place_id一括取得", "PAID_OP", async (request, ctx) => {
  if (!GCP_API_KEY) {
    return NextResponse.json({ error: "GCP_API_KEYが未設定です" }, { status: 500 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(20, Math.max(1, Number(body.limit) || 10));
  // カーソル（前回処理した最後の店舗名）。スキップされた店舗を再処理して
  // 無限ループしないよう、クライアントは lastName を渡して先へ進める
  const afterName: string = typeof body.afterName === "string" ? body.afterName : "";

  const supabase = getSupabase();

  // 未取得店舗を取得（名前順・カーソル以降）
  const picked: { id: string; name: string; gbp_latitude: number | null; gbp_longitude: number | null }[] = [];
  {
    let q = supabase
      .from("shops")
      .select("id, name, gbp_latitude, gbp_longitude, gbp_place_id")
      .or("gbp_place_id.is.null,gbp_place_id.eq.\"\"")
      .order("name")
      .limit(limit);
    if (afterName) q = q.gt("name", afterName);
    const { data: rows, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    picked.push(...(rows || []));
  }

  // 残数（今回の処理分を含む）
  const { count: nullCount } = await supabase
    .from("shops").select("id", { count: "exact", head: true }).is("gbp_place_id", null);
  const { count: emptyCount } = await supabase
    .from("shops").select("id", { count: "exact", head: true }).eq("gbp_place_id", "");
  const remainingBefore = (nullCount || 0) + (emptyCount || 0);

  if (picked.length === 0) {
    return NextResponse.json({ processed: 0, matched: 0, skipped: 0, remaining: remainingBefore, lastName: "", details: [] });
  }

  const details: { name: string; status: "matched" | "skipped"; method?: string; reason?: string }[] = [];
  let matched = 0;

  for (const shop of picked) {
    const shopName = (shop.name || "").normalize("NFC").trim();
    const hasCoords = !!(shop.gbp_latitude && shop.gbp_longitude && shop.gbp_latitude !== 0);
    try {
      const reqBody: any = {
        textQuery: shopName,
        languageCode: "ja",
        pageSize: 5,
      };
      if (hasCoords) {
        reqBody.locationBias = {
          circle: { center: { latitude: shop.gbp_latitude, longitude: shop.gbp_longitude }, radius: 1000 },
        };
      }
      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GCP_API_KEY,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location",
        },
        body: JSON.stringify(reqBody),
      });
      if (!res.ok) {
        details.push({ name: shopName, status: "skipped", reason: `API ${res.status}` });
        continue;
      }
      const data = await res.json();
      const places: { id: string; displayName?: { text?: string }; location?: { latitude: number; longitude: number } }[] = data.places || [];
      if (places.length === 0) {
        details.push({ name: shopName, status: "skipped", reason: "検索結果なし" });
        continue;
      }

      // 1) 表示名の完全一致（NFC）
      const exact = places.find(p => (p.displayName?.text || "").normalize("NFC").trim() === shopName);
      // 2) 店舗座標から150m以内の最寄り
      let nearest: { id: string; dist: number } | null = null;
      if (hasCoords) {
        for (const p of places) {
          if (!p.location) continue;
          const d = distanceM(shop.gbp_latitude!, shop.gbp_longitude!, p.location.latitude, p.location.longitude);
          if (!nearest || d < nearest.dist) nearest = { id: p.id, dist: d };
        }
        if (nearest && nearest.dist > 150) nearest = null;
      }

      const chosen = exact ? { id: exact.id, method: "表示名一致" }
        : nearest ? { id: nearest.id, method: `座標一致(${Math.round(nearest.dist)}m)` }
        : null;

      if (!chosen) {
        details.push({ name: shopName, status: "skipped", reason: hasCoords ? "150m以内に該当なし" : "座標なし・名前不一致" });
        continue;
      }

      const { error: upErr } = await supabase
        .from("shops")
        .update({ gbp_place_id: chosen.id })
        .eq("id", shop.id);
      if (upErr) {
        details.push({ name: shopName, status: "skipped", reason: `保存失敗: ${upErr.message}` });
        continue;
      }
      matched++;
      details.push({ name: shopName, status: "matched", method: chosen.method });
    } catch (e: any) {
      details.push({ name: shopName, status: "skipped", reason: e?.message || "不明なエラー" });
    }
    // レート制限回避（Text Search QPS対策）
    await new Promise(r => setTimeout(r, 120));
  }

  const remaining = Math.max(0, remainingBefore - matched);
  ctx.detail = `${picked.length}店舗処理: ID取得${matched}件 / スキップ${picked.length - matched}件 / 残り${remaining}店舗`;

  return NextResponse.json({
    processed: picked.length,
    matched,
    skipped: picked.length - matched,
    remaining,
    lastName: picked[picked.length - 1]?.name || "",
    details,
  });
});
