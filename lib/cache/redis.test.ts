import { buildCacheKey } from "./redis";

describe("buildCacheKey", () => {
  it("カード名・セット略号・コレクター番号が全て揃っている場合は正しいキーを生成する", () => {
    const key = buildCacheKey("Lightning Bolt", "M11", "149");
    expect(key).toBe("price:Lightning Bolt:M11:149");
  });

  it("setCode が null の場合は _ で置換する", () => {
    const key = buildCacheKey("Counterspell", null, "103");
    expect(key).toBe("price:Counterspell:_:103");
  });

  it("collectorNumber が null の場合は _ で置換する", () => {
    const key = buildCacheKey("Lightning Bolt", "M11", null);
    expect(key).toBe("price:Lightning Bolt:M11:_");
  });

  it("setCode と collectorNumber が両方 null の場合は両方 _ に置換する", () => {
    const key = buildCacheKey("Force of Will", null, null);
    expect(key).toBe("price:Force of Will:_:_");
  });

  it("カード名にコロンが含まれていても正しく処理する", () => {
    const key = buildCacheKey("Jace, the Mind Sculptor", "WWK", "31");
    expect(key).toBe("price:Jace, the Mind Sculptor:WWK:31");
  });

  it("同じパラメータは常に同一のキーを生成する（冪等性）", () => {
    const key1 = buildCacheKey("Black Lotus", "LEA", "232");
    const key2 = buildCacheKey("Black Lotus", "LEA", "232");
    expect(key1).toBe(key2);
  });
});
