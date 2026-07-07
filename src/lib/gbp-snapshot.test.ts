import { describe, it, expect } from "vitest";
import { catNameOf, addressOf, buildGbpSnapshot, detectGbpChanges } from "./gbp-snapshot";

const loc = (over: any = {}) => ({
  title: "サロンA",
  phoneNumbers: { primaryPhone: "06-1234-5678" },
  websiteUri: "https://example.com",
  categories: { primaryCategory: { displayName: "美容室", categoryId: "gcid:hair_salon" } },
  storefrontAddress: { addressLines: ["大阪市北区1-2-3"] },
  ...over,
});

describe("catNameOf", () => {
  it("displayNameがstringのとき", () => {
    expect(catNameOf({ categories: { primaryCategory: { displayName: "美容室" } } })).toBe("美容室");
  });
  it("displayNameがobject(text)のとき", () => {
    expect(catNameOf({ categories: { primaryCategory: { displayName: { text: "居酒屋" } } } })).toBe("居酒屋");
  });
  it("カテゴリ無しは空文字", () => {
    expect(catNameOf({})).toBe("");
    expect(catNameOf(null)).toBe("");
  });
});

describe("addressOf", () => {
  it("addressLinesを結合", () => {
    expect(addressOf({ storefrontAddress: { addressLines: ["A", "B"] } })).toBe("A B");
  });
  it("住所無しは空文字", () => {
    expect(addressOf({})).toBe("");
  });
});

describe("buildGbpSnapshot", () => {
  it("比較用文字列と復旧用rawの両方を保持する", () => {
    const s = buildGbpSnapshot(loc(), "2026-07-07T00:00:00.000Z");
    expect(s.title).toBe("サロンA");
    expect(s.phone).toBe("06-1234-5678");
    expect(s.website).toBe("https://example.com");
    expect(s.category).toBe("美容室");
    expect(s.address).toBe("大阪市北区1-2-3");
    // 復旧に使う構造化データ（カテゴリIDを含む）が保持されている
    expect(s.raw.primaryCategory).toEqual({ displayName: "美容室", categoryId: "gcid:hair_salon" });
    expect(s.raw.storefrontAddress).toEqual({ addressLines: ["大阪市北区1-2-3"] });
    expect(s.savedAt).toBe("2026-07-07T00:00:00.000Z");
  });
});

describe("detectGbpChanges", () => {
  it("変更なしなら空", () => {
    const prev = buildGbpSnapshot(loc(), "t");
    expect(detectGbpChanges(prev, loc())).toEqual([]);
  });

  it("店舗名の改ざんを検知（before=正常値, after=改ざん値）", () => {
    const prev = buildGbpSnapshot(loc(), "t");
    const tampered = loc({ title: "怪しい店名" });
    const alerts = detectGbpChanges(prev, tampered);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual({ field: "店舗名", before: "サロンA", after: "怪しい店名" });
  });

  it("電話・Web・カテゴリ・住所の複数変更を検知", () => {
    const prev = buildGbpSnapshot(loc(), "t");
    const tampered = loc({
      phoneNumbers: { primaryPhone: "00-0000-0000" },
      websiteUri: "https://evil.example",
      categories: { primaryCategory: { displayName: "別業種" } },
      storefrontAddress: { addressLines: ["別の住所"] },
    });
    const fields = detectGbpChanges(prev, tampered).map((a) => a.field);
    expect(fields).toEqual(["電話番号", "Webサイト", "メインカテゴリ", "住所"]);
  });

  it("空→値の初期化はアラートにしない（before/afterどちらかが空なら無視）", () => {
    const prev = buildGbpSnapshot(loc({ websiteUri: "" }), "t");
    const filled = loc({ websiteUri: "https://example.com" });
    expect(detectGbpChanges(prev, filled)).toEqual([]);
  });

  it("prevまたはdataがnullなら空", () => {
    expect(detectGbpChanges(null, loc())).toEqual([]);
    expect(detectGbpChanges(buildGbpSnapshot(loc(), "t"), null)).toEqual([]);
  });
});

/**
 * 復旧の核心不変条件を模擬:
 * 「改ざんが検知された場合、ベースラインを現在値(=改ざん値)で上書きしてはならない」。
 * これを守れば、復旧が読むベースラインは常に正常値のままになる。
 */
describe("復旧の核心: 改ざん検知時はベースラインを保持", () => {
  const store = new Map<string, string>();
  const KEY = "gbp-snapshot-shopX";

  // fetchLocation の判断ロジックを再現した最小モデル
  function onFetch(data: any) {
    const saved = store.get(KEY);
    let hadChange = false;
    if (saved && data) {
      const prev = JSON.parse(saved);
      if (detectGbpChanges(prev, data).length > 0) hadChange = true;
    }
    if (data && !hadChange) {
      store.set(KEY, JSON.stringify(buildGbpSnapshot(data, "t")));
    }
  }

  it("正常→改ざん→復旧で正常値が書き戻せる", () => {
    store.clear();
    // 1. 初回ロード(正常) → ベースライン確立
    onFetch(loc({ title: "正しい店名" }));
    // 2. 改ざん後にロード → ベースラインは保持されるべき
    onFetch(loc({ title: "改ざん店名" }));
    const baseline = JSON.parse(store.get(KEY)!);
    expect(baseline.title).toBe("正しい店名"); // 改ざん値で上書きされていない
    // 3. 復旧はこのベースラインを書き戻す → 正常値が復元される
    expect(baseline.title).not.toBe("改ざん店名");
  });
});
