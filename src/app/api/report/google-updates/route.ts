import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/report/google-updates
 * Google検索セントラルブログの最新記事を取得
 */
export async function GET() {
  try {
    // Google Search Central Blog RSS
    const rssUrl = "https://developers.google.com/search/blog/rss.xml";
    const res = await fetch(rssUrl, {
      next: { revalidate: 3600 }, // 1時間キャッシュ
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ updates: [], error: `RSS取得失敗: ${res.status}` });
    }

    const xml = await res.text();

    // 簡易XMLパース（entry or item）
    const entries: { title: string; link: string; published: string }[] = [];

    // Atom形式（<entry>）
    const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
    for (const entry of entryMatches.slice(0, 5)) {
      const title = entry.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
      const link = entry.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] || entry.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] || "";
      const published = entry.match(/<published>([\s\S]*?)<\/published>/)?.[1] || entry.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || "";
      if (title) entries.push({ title, link, published });
    }

    // RSS形式（<item>）にフォールバック
    if (entries.length === 0) {
      const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
      for (const item of itemMatches.slice(0, 5)) {
        const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").trim() || "";
        const link = item.match(/<link>([\s\S]*?)<\/link>/)?.[1] || "";
        const published = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] || "";
        if (title) entries.push({ title, link, published });
      }
    }

    return NextResponse.json({ updates: entries });
  } catch (e: any) {
    return NextResponse.json({ updates: [], error: e.message });
  }
}
