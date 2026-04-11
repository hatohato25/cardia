import { buildCacheKey } from "./redis";

describe("buildCacheKey", () => {
  it("デフォルト shop（hareruya）でキーを生成する", () => {
    const key = buildCacheKey("Lightning Bolt", "M11", "149");
    expect(key).toBe("price:hareruya:Lightning Bolt:M11:149");
  });

  it("shop=hareruya を明示した場合は同じキーを生成する", () => {
    const key = buildCacheKey("Lightning Bolt", "M11", "149", "hareruya");
    expect(key).toBe("price:hareruya:Lightning Bolt:M11:149");
  });

  it("shop=hareruya2 の場合は異なるキーを生成する", () => {
    const key = buildCacheKey("ナンジャモのカイデン", null, null, "hareruya2");
    expect(key).toBe("price:hareruya2:ナンジャモのカイデン:_:_");
  });

  it("同名カードでも shop が違えば別のキーになる", () => {
    const key1 = buildCacheKey("Pikachu", null, null, "hareruya");
    const key2 = buildCacheKey("Pikachu", null, null, "hareruya2");
    expect(key1).not.toBe(key2);
  });

  it("setCode が null の場合は _ で置換する", () => {
    const key = buildCacheKey("Counterspell", null, "103");
    expect(key).toBe("price:hareruya:Counterspell:_:103");
  });

  it("collectorNumber が null の場合は _ で置換する", () => {
    const key = buildCacheKey("Lightning Bolt", "M11", null);
    expect(key).toBe("price:hareruya:Lightning Bolt:M11:_");
  });

  it("setCode と collectorNumber が両方 null の場合は両方 _ に置換する", () => {
    const key = buildCacheKey("Force of Will", null, null);
    expect(key).toBe("price:hareruya:Force of Will:_:_");
  });

  it("カード名にコロンが含まれていても正しく処理する", () => {
    const key = buildCacheKey("Jace, the Mind Sculptor", "WWK", "31");
    expect(key).toBe("price:hareruya:Jace, the Mind Sculptor:WWK:31");
  });

  it("同じパラメータは常に同一のキーを生成する（冪等性）", () => {
    const key1 = buildCacheKey("Black Lotus", "LEA", "232");
    const key2 = buildCacheKey("Black Lotus", "LEA", "232");
    expect(key1).toBe(key2);
  });
});
