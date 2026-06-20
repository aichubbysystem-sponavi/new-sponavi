import { describe, it, expect } from "vitest";
import {
  gridRankingSchema,
  memoSchema,
  generatePostSchema,
  userCreateSchema,
  bulkGenerateSchema,
  replySuggestSchema,
  updateCommentsSchema,
  displaySettingsSchema,
  shopIdSchema,
  monthSchema,
} from "./validation";

describe("shopIdSchema", () => {
  it("正常なUUIDを受け入れる", () => {
    expect(shopIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
  });
  it("不正なIDを拒否する", () => {
    expect(shopIdSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(shopIdSchema.safeParse("").success).toBe(false);
  });
});

describe("monthSchema", () => {
  it("YYYY/M 形式を受け入れる", () => {
    expect(monthSchema.safeParse("2026/3").success).toBe(true);
    expect(monthSchema.safeParse("2026/12").success).toBe(true);
  });
  it("不正な形式を拒否する", () => {
    expect(monthSchema.safeParse("2026-03").success).toBe(false);
    expect(monthSchema.safeParse("").success).toBe(false);
  });
});

describe("gridRankingSchema", () => {
  it("正常な入力を受け入れる", () => {
    const result = gridRankingSchema.safeParse({
      shopId: "550e8400-e29b-41d4-a716-446655440000",
      keyword: "ラーメン",
      lat: 35.6812,
      lng: 139.7671,
    });
    expect(result.success).toBe(true);
  });
  it("キーワードなしを拒否する", () => {
    const result = gridRankingSchema.safeParse({
      shopId: "550e8400-e29b-41d4-a716-446655440000",
      keyword: "",
      lat: 35.6812,
      lng: 139.7671,
    });
    expect(result.success).toBe(false);
  });
  it("緯度が範囲外を拒否する", () => {
    const result = gridRankingSchema.safeParse({
      shopId: "550e8400-e29b-41d4-a716-446655440000",
      keyword: "ラーメン",
      lat: 91,
      lng: 139.7671,
    });
    expect(result.success).toBe(false);
  });
  it("キーワード101文字を拒否する", () => {
    const result = gridRankingSchema.safeParse({
      shopId: "550e8400-e29b-41d4-a716-446655440000",
      keyword: "a".repeat(101),
      lat: 35,
      lng: 139,
    });
    expect(result.success).toBe(false);
  });
});

describe("memoSchema", () => {
  it("正常な入力を受け入れる", () => {
    const result = memoSchema.safeParse({
      shopName: "テスト店舗",
      month: "2026/6",
      memo: "今月は口コミが増加",
    });
    expect(result.success).toBe(true);
  });
  it("5001文字のメモを拒否する", () => {
    const result = memoSchema.safeParse({
      shopName: "テスト店舗",
      month: "2026/6",
      memo: "あ".repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe("generatePostSchema", () => {
  it("最小限の入力を受け入れる", () => {
    const result = generatePostSchema.safeParse({ shopName: "テスト" });
    expect(result.success).toBe(true);
  });
  it("全フィールド指定を受け入れる", () => {
    const result = generatePostSchema.safeParse({
      shopName: "テスト",
      topicType: "event",
      keywords: "新メニュー",
      tone: "カジュアル",
      count: 3,
    });
    expect(result.success).toBe(true);
  });
  it("count=11を拒否する", () => {
    const result = generatePostSchema.safeParse({
      shopName: "テスト",
      count: 11,
    });
    expect(result.success).toBe(false);
  });
});

describe("userCreateSchema", () => {
  it("正常な入力を受け入れる", () => {
    const result = userCreateSchema.safeParse({
      name: "田中太郎",
      username: "tanaka",
      password: "securepassword123",
      role: "manager",
    });
    expect(result.success).toBe(true);
  });
  it("短すぎるパスワードを拒否する", () => {
    const result = userCreateSchema.safeParse({
      name: "田中太郎",
      username: "tanaka",
      password: "short",
    });
    expect(result.success).toBe(false);
  });
  it("不正なロールを拒否する", () => {
    const result = userCreateSchema.safeParse({
      name: "田中太郎",
      username: "tanaka",
      password: "securepassword123",
      role: "superadmin",
    });
    expect(result.success).toBe(false);
  });
});

describe("bulkGenerateSchema", () => {
  it("正常な入力を受け入れる", () => {
    const result = bulkGenerateSchema.safeParse({
      shopIds: ["550e8400-e29b-41d4-a716-446655440000"],
      startDate: "2026-06-20",
    });
    expect(result.success).toBe(true);
  });
  it("51店舗を拒否する", () => {
    const ids = Array.from({ length: 51 }, () => "550e8400-e29b-41d4-a716-446655440000");
    const result = bulkGenerateSchema.safeParse({
      shopIds: ids,
      startDate: "2026-06-20",
    });
    expect(result.success).toBe(false);
  });
  it("不正な日付形式を拒否する", () => {
    const result = bulkGenerateSchema.safeParse({
      shopIds: ["550e8400-e29b-41d4-a716-446655440000"],
      startDate: "2026/06/20",
    });
    expect(result.success).toBe(false);
  });
});

describe("replySuggestSchema", () => {
  it("5001文字の口コミを拒否する", () => {
    const result = replySuggestSchema.safeParse({
      shopName: "テスト",
      comment: "あ".repeat(5001),
    });
    expect(result.success).toBe(false);
  });
});

describe("updateCommentsSchema", () => {
  it("正常な入力を受け入れる", () => {
    const result = updateCommentsSchema.safeParse({
      shopName: "テスト店舗",
      comments: ["コメント1", "コメント2"],
      targetMonth: "2026/6",
    });
    expect(result.success).toBe(true);
  });
  it("11個のコメントを拒否する", () => {
    const result = updateCommentsSchema.safeParse({
      shopName: "テスト",
      comments: Array.from({ length: 11 }, (_, i) => `コメント${i}`),
      targetMonth: "2026/6",
    });
    expect(result.success).toBe(false);
  });
});

describe("displaySettingsSchema", () => {
  it("正常な入力を受け入れる", () => {
    const result = displaySettingsSchema.safeParse({
      shopId: "550e8400-e29b-41d4-a716-446655440000",
      sectionVisibility: { reviews: true, performance: false },
    });
    expect(result.success).toBe(true);
  });
});
