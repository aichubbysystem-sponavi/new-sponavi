/**
 * APIリクエストのバリデーションスキーマ集
 * zod による入力値検証
 */
import { z } from "zod";
import { NextResponse } from "next/server";

// ── 共通スキーマ ──

export const shopIdSchema = z.string().uuid("shopIdはUUID形式が必要です");
export const shopNameSchema = z.string().min(1, "shopNameが必要です").max(200, "shopNameが長すぎます");
export const monthSchema = z.string().regex(/^\d{4}\/\d{1,2}$/, "monthは YYYY/M 形式が必要です");

// ── API固有スキーマ ──

export const gridRankingSchema = z.object({
  shopId: shopIdSchema,
  keyword: z.string().min(1, "keywordが必要です").max(100, "keywordが長すぎます"),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const gridRankingPutSchema = z.object({
  shopId: shopIdSchema,
  keyword: z.string().min(1).max(100),
  gridResults: z.array(z.object({
    lat: z.number(),
    lng: z.number(),
    rank: z.number().int().min(0),
    row: z.number().int(),
    col: z.number().int(),
  })).max(400, "グリッド結果は400件以下"),
  gridSize: z.number().int().min(1).max(20),
  interval: z.number().min(100).max(10000),
});

export const memoSchema = z.object({
  shopName: shopNameSchema,
  month: monthSchema,
  memo: z.string().max(5000, "メモは5000文字以下"),
});

export const generatePostSchema = z.object({
  shopName: shopNameSchema,
  topicType: z.enum(["event", "offer", "product", "update", "standard", "TRANSLATE", "PROOF"]).optional(),
  keywords: z.string().max(500, "キーワードは500文字以下").optional(),
  tone: z.string().max(100).optional(),
  count: z.number().int().min(1).max(10).optional(),
  targetLang: z.string().max(50).optional(),
});

export const replySuggestSchema = z.object({
  shopName: shopNameSchema,
  reviewerName: z.string().max(200).optional(),
  comment: z.string().max(5000, "口コミは5000文字以下"),
  starRating: z.number().int().min(1).max(5).optional(),
  tone: z.string().max(100).optional(),
});

export const bulkGenerateSchema = z.object({
  shopIds: z.array(shopIdSchema).min(1).max(50, "一度に50店舗まで"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日付はYYYY-MM-DD形式"),
});

export const userCreateSchema = z.object({
  name: z.string().min(1, "名前が必要です").max(100),
  username: z.string().min(1, "ユーザー名が必要です").max(50),
  password: z.string().min(8, "パスワードは8文字以上").max(100),
  role: z.enum(["president", "executive", "manager", "part_time"]).optional(),
});

export const displaySettingsSchema = z.object({
  shopId: shopIdSchema,
  sectionVisibility: z.record(z.string(), z.boolean()).optional(),
  kwVisibility: z.record(z.string(), z.boolean()).optional(),
  rwVisibility: z.record(z.string(), z.boolean()).optional(),
});

export const updateCommentsSchema = z.object({
  shopName: shopNameSchema,
  comments: z.array(z.string().max(2000)).max(10),
  targetMonth: monthSchema,
});

// ── バリデーションヘルパー ──

/**
 * リクエストボディをzodスキーマで検証
 * 失敗時は400レスポンスを返す
 */
export async function validateBody<T extends z.ZodType>(
  request: Request,
  schema: T
): Promise<{ data: z.infer<T>; error?: never } | { data?: never; error: NextResponse }> {
  try {
    const body = await request.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      const messages = result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`);
      return { error: NextResponse.json({ error: "入力値が不正です", details: messages }, { status: 400 }) };
    }
    return { data: result.data };
  } catch {
    return { error: NextResponse.json({ error: "リクエストボディのJSONが不正です" }, { status: 400 }) };
  }
}
