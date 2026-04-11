import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GCP_API_KEY = process.env.GCP_API_KEY || "";

/**
 * POST /api/report/keyword-volume
 * キーワードの検索ボリューム推定（Places API結果件数ベース）
 */
export async function POST(request: NextRequest) {
  const { verifyAuth } = await import("@/lib/auth-verify");
  const auth = await verifyAuth(request.headers.get("authorization"));
  if (!auth.valid) return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  if (!GCP_API_KEY) return NextResponse.json({ error: "GCP_API_KEYが設定されていません" }, { status: 500 });

  const body = await request.json();
  const { keywords, lat, lng } = body as { keywords: string[]; lat?: number; lng?: number };

  if (!keywords || keywords.length === 0) {
    return NextResponse.json({ error: "keywordsが必要です" }, { status: 400 });
  }

  const results: { keyword: string; resultCount: number; level: string }[] = [];

  for (const keyword of keywords.slice(0, 10)) {
    try {
      const searchBody: any = {
        textQuery: keyword,
        maxResultCount: 20,
        languageCode: "ja",
      };
      if (lat && lng) {
        searchBody.locationBias = {
          circle: { center: { latitude: lat, longitude: lng }, radius: 5000 },
        };
      }

      const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": GCP_API_KEY,
          "X-Goog-FieldMask": "places.displayName",
        },
        body: JSON.stringify(searchBody),
      });

      if (!res.ok) {
        results.push({ keyword, resultCount: 0, level: "エラー" });
        continue;
      }

      const data = await res.json();
      const count = data.places?.length || 0;

      // 20件=MAX返却なので、20件ならボリューム「多」と推定
      const level = count >= 20 ? "多（競争高）" : count >= 10 ? "中（推奨）" : count >= 3 ? "少（狙い目）" : "極少";

      results.push({ keyword, resultCount: count, level });
    } catch {
      results.push({ keyword, resultCount: 0, level: "エラー" });
    }
  }

  return NextResponse.json({ results });
}
