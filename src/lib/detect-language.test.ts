import { describe, it, expect } from "vitest";
import { detectLanguage, starToNum } from "./detect-language";

describe("detectLanguage", () => {
  describe("英語が単語1つの綴り衝突で外国語に化けないこと（2026-08-01 修正）", () => {
    // 単語ベース規則を1語マッチで確定していたため実際に化けていた文例
    it.each([
      ["Dan was very helpful, great service!", "人名Danがインドネシア語規則に一致"],
      ["The staff die-hard fans loved it", "dieがドイツ語規則に一致"],
      ["I sono a big fan is a typo but still english", "sonoがイタリア語規則に一致"],
      ["We had a con call before visiting", "conがスペイン語規則に一致"],
      ["Mais bakery style bread was good", "maisがポルトガル語規則に一致"],
    ])("%s は英語と判定される", (text) => {
      expect(detectLanguage(text).lang).toBe("英語");
    });
  });

  describe("本物の外国語は正しく判定される（2語以上で確定）", () => {
    it("ドイツ語", () => {
      expect(detectLanguage("Das Essen ist sehr gut und der Service auch").lang).toBe("ドイツ語");
    });
    it("インドネシア語", () => {
      expect(detectLanguage("Makanan ini sangat enak dan pelayanan yang baik").lang).toBe("インドネシア語");
    });
    it("フランス語", () => {
      expect(detectLanguage("Le repas est très bon avec beaucoup de choix").lang).toBe("フランス語");
    });
    it("スペイン語", () => {
      expect(detectLanguage("La comida es muy buena pero el servicio es lento").lang).toBe("スペイン語");
    });
    it("イタリア語", () => {
      expect(detectLanguage("Molto buono, grazie! Tutto era ottimo").lang).toBe("イタリア語");
    });
  });

  describe("文字種で決まる言語", () => {
    it("日本語（ひらがな1文字でも）", () => {
      expect(detectLanguage("とても美味しかったです").lang).toBe("日本語");
      expect(detectLanguage("Sushi が美味しい").lang).toBe("日本語");
    });
    it("韓国語", () => {
      expect(detectLanguage("정말 맛있었어요").lang).toBe("韓国語");
    });
    it("中国語（漢字のみ・かな無し）", () => {
      expect(detectLanguage("非常好吃的餐厅").lang).toBe("中国語（簡体）");
    });
    it("タイ語", () => {
      expect(detectLanguage("อร่อยมาก").lang).toBe("タイ語");
    });
    it("ロシア語", () => {
      expect(detectLanguage("Очень вкусно").lang).toBe("ロシア語");
    });
  });

  describe("ベトナム語判定がフランス語・ポルトガル語を巻き込まないこと", () => {
    it("ベトナム語固有の文字で判定される", () => {
      expect(detectLanguage("Món ăn rất ngon, được phục vụ tốt").lang).toBe("ベトナム語");
    });
    it("フランス語の être はベトナム語にならない", () => {
      expect(detectLanguage("C'est très bon, nous sommes dans le quartier").lang).toBe("フランス語");
    });
    it("ポルトガル語の você はベトナム語にならない", () => {
      expect(detectLanguage("Muito bom, mas você precisa reservar com antecedência").lang).toBe("ポルトガル語");
    });
  });

  describe("GBPの翻訳フォーマットは原文を判定する", () => {
    it("(Original) 以降の原文で判定する（翻訳文ではない）", () => {
      const gbp = "(Translated by Google) とても美味しい (Original) 정말 맛있어요";
      expect(detectLanguage(gbp).lang).toBe("韓国語");
    });
    it("マーカーだけの場合は翻訳文で判定する", () => {
      expect(detectLanguage("(Translated by Google) とても美味しい").lang).toBe("日本語");
    });
  });

  describe("空・不正入力", () => {
    it.each([null, undefined, "", "   "])("%s は不明", (v) => {
      expect(detectLanguage(v as string).lang).toBe("不明");
    });
    it("記号のみは不明", () => {
      expect(detectLanguage("!!!???").lang).toBe("不明");
    });
  });

  it("同じ入力を繰り返しても結果が変わらない（/g の lastIndex 汚染がない）", () => {
    const text = "Das Essen ist sehr gut und der Service auch";
    const first = detectLanguage(text).lang;
    for (let i = 0; i < 5; i++) {
      expect(detectLanguage(text).lang).toBe(first);
    }
  });
});

describe("starToNum", () => {
  it("星表記を数値に変換する", () => {
    expect(starToNum("FIVE")).toBe(5);
    expect(starToNum("five_stars")).toBe(5);
    expect(starToNum("ONE")).toBe(1);
  });
  it("未知の値は0", () => {
    expect(starToNum("")).toBe(0);
    expect(starToNum("UNKNOWN")).toBe(0);
  });
});

describe("ベトナム語の声調符号付き母音（U+1EA0-1EF9）", () => {
  it("ă/đ/ơ/ư を含まない声調符号のみの文もベトナム語と判定する", () => {
    // 2026-08-01のレビューで英語と誤判定されていた実例
    expect(detectLanguage("Rất ngon và sạch sẽ").lang).toBe("ベトナム語");
  });

  it("ạ ế ộ などの声調符号付き母音で判定する", () => {
    expect(detectLanguage("Món ăn rất tuyệt vời, phục vụ tốt").lang).toBe("ベトナム語");
  });

  it("フランス語の â/ê は引き続きベトナム語と誤判定しない", () => {
    expect(detectLanguage("C'était une très bonne expérience").lang).not.toBe("ベトナム語");
  });
});
