import { NextRequest, NextResponse } from "next/server";
import { getSupabase, requireRole } from "@/lib/supabase";
import { centerCell } from "@/lib/report-utils";
import { normalizeKw } from "@/lib/keyword-normalize";
import { detectLanguage } from "@/lib/detect-language";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * GET /api/export?type=<種別>&month=YYYY-MM
 * 全店舗まとめCSVエクスポート（社長・幹部・社員）
 *
 * type:
 *  - insights         レポート数値（performance_metrics_cache）
 *  - search-keywords  検索語句（search_query_cache）
 *  - grid-ranking     多地点順位（grid_ranking_logs）
 *  - reviews          口コミ一覧（reviews）
 *  - review-analysis  口コミ分析AI（report_analysis）
 *  - review-language  口コミ国別（reviews + detectLanguage）
 *  - pmax             P-MAX広告（pmax_store_data）
 *  - posts            投稿ログ（post_logs）
 *
 * 月フォーマットはテーブルごとに異なるため内部で変換する:
 *  "2026/7"(insights, search-keywords, review-analysis) / "2026-07"(pmax) / timestamp範囲(その他)
 */

// PostgRESTは.limit(N)を指定しても1000行で切られるため、必ず.range()でページングする
const PAGE = 1000;
async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; from < 500000; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1);
    if (error) throw new Error(error.message || "DB取得エラー");
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

// CSVエスケープ（カンマ・引用符・改行を含むセルを引用符で包む）
function esc(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(header: string[], rows: unknown[][]): string {
  const BOM = "﻿"; // Excelの文字化け防止
  return BOM + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

function csvResponse(csv: string, filename: string, rowCount: number): NextResponse {
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
      "X-Row-Count": String(rowCount),
    },
  });
}

// JSTのタイムスタンプ表示 "2026-07-31 12:34"
function jstDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).format(new Date(iso));
  } catch { return ""; }
}

// GBPの星評価文字列 → 数値文字列
const RATING_MAP: Record<string, string> = {
  ONE: "1", TWO: "2", THREE: "3", FOUR: "4", FIVE: "5",
  ONE_STAR: "1", TWO_STARS: "2", THREE_STARS: "3", FOUR_STARS: "4", FIVE_STARS: "5",
};
function ratingNum(v: string | null | undefined): number {
  return Number(RATING_MAP[v || ""] || 0);
}

interface MonthKeys {
  hyphen: string;      // "2026-07"（pmax_store_data）
  slashNoPad: string;  // "2026/7"（performance_metrics_cache / search_query_cache / report_analysis）
  startIso: string;    // JST月初 の UTC ISO（timestamp範囲フィルタ用）
  endIso: string;      // JST翌月初 の UTC ISO
}
function parseMonth(month: string): MonthKeys | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const ny = mo === 12 ? y + 1 : y;
  const nmo = mo === 12 ? 1 : mo + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    hyphen: `${y}-${pad(mo)}`,
    slashNoPad: `${y}/${mo}`,
    startIso: new Date(`${y}-${pad(mo)}-01T00:00:00+09:00`).toISOString(),
    endIso: new Date(`${ny}-${pad(nmo)}-01T00:00:00+09:00`).toISOString(),
  };
}

export async function GET(request: NextRequest) {
  const roleCheck = await requireRole(request, ["president", "executive", "manager"]);
  if (roleCheck.error) return roleCheck.error;

  const type = request.nextUrl.searchParams.get("type") || "";
  const monthParam = request.nextUrl.searchParams.get("month") || "";
  const mk = parseMonth(monthParam);
  if (!mk) {
    return NextResponse.json({ error: "month=YYYY-MM 形式で指定してください" }, { status: 400 });
  }

  const sb = getSupabase();

  try {
    switch (type) {
      // ── レポート数値（GBPインサイト月次） ─────────────────────────
      case "insights": {
        const rows = await fetchAll<any>((f, t) =>
          sb.from("performance_metrics_cache")
            .select("shop_name, month, metrics, updated_at")
            .eq("month", mk.slashNoPad)
            .order("updated_at", { ascending: false })
            .order("shop_id", { ascending: true }) // ページング安定用
            .range(f, t)
        );
        // 同一店舗名の重複行（shop_id世代違い）は最新updated_atのみ採用
        const seen = new Set<string>();
        const out: unknown[][] = [];
        for (const r of rows) {
          const name = (r.shop_name || "").normalize("NFC");
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const m = r.metrics || {};
          out.push([
            name, r.month,
            (m.searchMobile || 0) + (m.searchPC || 0),
            m.searchMobile || 0, m.searchPC || 0,
            (m.mapMobile || 0) + (m.mapPC || 0),
            m.mapMobile || 0, m.mapPC || 0,
            m.websites || 0, m.routes || 0, m.calls || 0,
            m.messages || 0, m.bookings || 0, m.foodMenus || 0, m.foodOrders || 0,
          ]);
        }
        out.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ja"));
        const csv = toCsv(
          ["店舗名", "月", "Google検索 合計", "検索(モバイル)", "検索(PC)", "Googleマップ 合計", "マップ(モバイル)", "マップ(PC)", "ウェブサイトクリック", "ルート検索", "通話", "メッセージ", "予約", "フードメニュー", "フード注文"],
          out
        );
        return csvResponse(csv, `レポート数値_${mk.hyphen}.csv`, out.length);
      }

      // ── 検索語句 ─────────────────────────────────────────────
      case "search-keywords": {
        const rows = await fetchAll<any>((f, t) =>
          sb.from("search_query_cache")
            .select("shop_name, month, keywords, updated_at")
            .eq("month", mk.slashNoPad)
            .order("updated_at", { ascending: false })
            .order("shop_id", { ascending: true }) // ページング安定用
            .range(f, t)
        );
        const seen = new Set<string>();
        const out: unknown[][] = [];
        for (const r of rows) {
          const name = (r.shop_name || "").normalize("NFC");
          if (!name || seen.has(name)) continue;
          seen.add(name);
          const kws: { word: string; count: number }[] = Array.isArray(r.keywords) ? r.keywords : [];
          const sorted = [...kws].sort((a, b) => (b.count || 0) - (a.count || 0));
          sorted.forEach((k, i) => {
            out.push([name, r.month, i + 1, k.word || "", k.count || 0]);
          });
        }
        const csv = toCsv(["店舗名", "月", "順位", "検索語句", "表示回数"], out);
        return csvResponse(csv, `検索語句_${mk.hyphen}.csv`, out.length);
      }

      // ── 多地点順位 ────────────────────────────────────────────
      case "grid-ranking": {
        const [logs, shops] = await Promise.all([
          fetchAll<any>((f, t) =>
            sb.from("grid_ranking_logs")
              .select("shop_id, keyword, grid_size, interval_m, results, measured_at")
              .gte("measured_at", mk.startIso)
              .lt("measured_at", mk.endIso)
              .order("measured_at", { ascending: false })
              .order("id", { ascending: true }) // ページング安定用
              .range(f, t)
          ),
          fetchAll<{ id: string; name: string }>((f, t) =>
            sb.from("shops").select("id, name").order("id").range(f, t)
          ),
        ]);
        const nameMap = new Map(shops.map((s) => [s.id, s.name]));
        // 同月内に複数回計測がある場合は最新のみ（measured_at降順で最初に出た行）
        const seen = new Set<string>();
        const out: unknown[][] = [];
        for (const log of logs) {
          const key = `${log.shop_id}::${normalizeKw(log.keyword || "")}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const results: { row: number; col: number; rank: number }[] = Array.isArray(log.results) ? log.results : [];
          if (results.length === 0) continue;
          const ranked = results.filter((r) => r.rank > 0);
          const center = centerCell(results, log.grid_size);
          let centerRank: string | number;
          if (center) {
            centerRank = center.rank > 0 ? center.rank : "圏外";
          } else {
            // 旧4地点計測（偶数グリッド）は中心が無いため圏内平均で代替
            centerRank = ranked.length > 0
              ? Math.round((ranked.reduce((s, r) => s + r.rank, 0) / ranked.length) * 10) / 10
              : "圏外";
          }
          const layout = log.grid_size === 2 ? "4地点" : (log.grid_size === 3 && results.length === 5) ? "5地点" : `${log.grid_size}×${log.grid_size}`;
          out.push([
            nameMap.get(log.shop_id) || log.shop_id,
            normalizeKw(log.keyword || ""),
            layout,
            centerRank,
            ranked.length > 0 ? Math.round((ranked.reduce((s, r) => s + r.rank, 0) / ranked.length) * 10) / 10 : "圏外",
            ranked.filter((r) => r.rank <= 3).length,
            ranked.filter((r) => r.rank <= 10).length,
            results.length - ranked.length,
            results.length,
            log.interval_m || "",
            jstDateTime(log.measured_at),
          ]);
        }
        out.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "ja") || String(a[1]).localeCompare(String(b[1]), "ja"));
        const csv = toCsv(
          ["店舗名", "キーワード", "計測レイアウト", "中心順位", "平均順位(圏内)", "TOP3地点", "TOP10地点", "圏外地点", "計測地点数", "距離(m)", "計測日時"],
          out
        );
        return csvResponse(csv, `多地点順位_${mk.hyphen}.csv`, out.length);
      }

      // ── 口コミ一覧 ────────────────────────────────────────────
      case "reviews": {
        const rows = await fetchAll<any>((f, t) =>
          sb.from("reviews")
            .select("shop_name, reviewer_name, star_rating, comment, reply_comment, create_time")
            .gte("create_time", mk.startIso)
            .lt("create_time", mk.endIso)
            .order("shop_name", { ascending: true })
            .order("create_time", { ascending: true })
            .order("id", { ascending: true })
            .range(f, t)
        );
        const out = rows.map((r) => [
          (r.shop_name || "").normalize("NFC"),
          jstDateTime(r.create_time),
          r.reviewer_name || "匿名",
          ratingNum(r.star_rating) || "",
          r.comment || "",
          r.reply_comment ? "返信済み" : "未返信",
          r.reply_comment || "",
        ]);
        const csv = toCsv(["店舗名", "投稿日時", "投稿者", "評価", "口コミ", "返信状態", "返信内容"], out);
        return csvResponse(csv, `口コミ一覧_${mk.hyphen}.csv`, out.length);
      }

      // ── 口コミ分析AI ──────────────────────────────────────────
      case "review-analysis": {
        const rows = await fetchAll<any>((f, t) =>
          sb.from("report_analysis")
            .select("shop_name, target_month, review_count, average_rating, positive_words, negative_words, summary")
            .eq("target_month", mk.slashNoPad)
            .order("shop_name", { ascending: true })
            .range(f, t)
        );
        const out = rows.map((r) => [
          (r.shop_name || "").normalize("NFC"),
          r.target_month,
          r.review_count ?? "",
          r.average_rating ?? "",
          Array.isArray(r.positive_words) ? r.positive_words.join("｜") : "",
          Array.isArray(r.negative_words) ? r.negative_words.join("｜") : "",
          r.summary || "",
        ]);
        const csv = toCsv(["店舗名", "対象月", "口コミ数", "平均評価", "ポジティブワード", "ネガティブワード", "AI総評"], out);
        return csvResponse(csv, `口コミ分析AI_${mk.hyphen}.csv`, out.length);
      }

      // ── 口コミ国別（言語判定つき） ─────────────────────────────
      case "review-language": {
        const rows = await fetchAll<any>((f, t) =>
          sb.from("reviews")
            .select("shop_name, star_rating, comment, create_time")
            .gte("create_time", mk.startIso)
            .lt("create_time", mk.endIso)
            .not("comment", "is", null)
            .neq("comment", "")
            .order("shop_name", { ascending: true })
            .order("create_time", { ascending: true })
            .order("id", { ascending: true })
            .range(f, t)
        );
        // 店舗×言語で集計
        interface LangAgg { country: string; total: number; stars: number[]; low: number }
        const byShop = new Map<string, Map<string, LangAgg>>();
        for (const r of rows) {
          const name = (r.shop_name || "").normalize("NFC");
          if (!name) continue;
          const det = detectLanguage(r.comment);
          const star = ratingNum(r.star_rating);
          let langs = byShop.get(name);
          if (!langs) { langs = new Map(); byShop.set(name, langs); }
          let agg = langs.get(det.lang);
          if (!agg) { agg = { country: det.country, total: 0, stars: [0, 0, 0, 0, 0], low: 0 }; langs.set(det.lang, agg); }
          agg.total++;
          if (star >= 1 && star <= 5) agg.stars[star - 1]++;
          if (star >= 1 && star <= 3) agg.low++;
        }
        const out: unknown[][] = [];
        const shopNames = Array.from(byShop.keys()).sort((a, b) => a.localeCompare(b, "ja"));
        for (const name of shopNames) {
          const langs = Array.from(byShop.get(name)!.entries()).sort((a, b) => b[1].total - a[1].total);
          const shopTotal = langs.reduce((s, [, a]) => s + a.total, 0);
          for (const [lang, a] of langs) {
            out.push([
              name, lang, a.country, a.total,
              shopTotal > 0 ? `${Math.round((a.total / shopTotal) * 1000) / 10}%` : "",
              a.stars[4], a.stars[3], a.stars[2], a.stars[1], a.stars[0],
              a.low,
            ]);
          }
        }
        const csv = toCsv(
          ["店舗名", "言語", "推定国", "件数", "構成比", "★5", "★4", "★3", "★2", "★1", "低評価数(★1-3)"],
          out
        );
        return csvResponse(csv, `口コミ国別_${mk.hyphen}.csv`, out.length);
      }

      // ── P-MAX広告 ─────────────────────────────────────────────
      case "pmax": {
        const rows = await fetchAll<any>((f, t) =>
          sb.from("pmax_store_data")
            .select("shop_name, language, month, campaign_name, impressions, clicks, ctr, average_cpc, cost_micros")
            .eq("month", mk.hyphen)
            .order("shop_name", { ascending: true })
            .order("language", { ascending: true })
            .order("campaign_id", { ascending: true }) // ページング安定用
            .range(f, t)
        );
        const out = rows.map((r) => [
          r.shop_name || "",
          r.month,
          r.language || "",
          r.campaign_name || "",
          r.impressions || 0,
          r.clicks || 0,
          r.ctr ? `${Math.round(r.ctr * 10000) / 100}%` : "0%",
          r.average_cpc ? Math.round(r.average_cpc / 1_000_000) : 0,
          r.cost_micros ? Math.round(r.cost_micros / 1_000_000) : 0,
        ]);
        const csv = toCsv(
          ["店舗名", "月", "言語", "キャンペーン名", "表示回数", "クリック数", "CTR", "平均CPC(円)", "費用(円)"],
          out
        );
        return csvResponse(csv, `PMAX広告_${mk.hyphen}.csv`, out.length);
      }

      // ── 投稿ログ ─────────────────────────────────────────────
      case "posts": {
        const rows = await fetchAll<any>((f, t) =>
          sb.from("post_logs")
            .select("shop_name, topic_type, summary, media_url, created_at")
            .gte("created_at", mk.startIso)
            .lt("created_at", mk.endIso)
            .order("shop_name", { ascending: true })
            .order("created_at", { ascending: true })
            .order("id", { ascending: true }) // ページング安定用
            .range(f, t)
        );
        const out = rows.map((r) => [
          (r.shop_name || "").normalize("NFC"),
          jstDateTime(r.created_at),
          r.topic_type === "PHOTO" ? "写真" : r.topic_type || "",
          r.summary || "",
          r.media_url || "",
        ]);
        const csv = toCsv(["店舗名", "投稿日時", "種別", "本文", "写真URL"], out);
        return csvResponse(csv, `投稿ログ_${mk.hyphen}.csv`, out.length);
      }

      default:
        return NextResponse.json({ error: `不明なtypeです: ${type}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error(`[export] type=${type} month=${monthParam} error:`, err?.message || err);
    return NextResponse.json({ error: err?.message || "エクスポートに失敗しました" }, { status: 500 });
  }
}
