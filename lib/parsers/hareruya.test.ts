import { parseHareruyaHtml, fetchHareruyaPrice } from "./hareruya";

// 実際のHareruyaのHTMLスニペットを模したテスト用HTML
// NOTE: 実際のHTML構造が変わった場合はセレクタとともにこのテストも更新する

const MOCK_HTML_WITH_PRICE = `
<!DOCTYPE html>
<html lang="ja">
<body>
  <div class="product-list">
    <div class="product-list__item">
      <h3 class="product-list__name">Lightning Bolt</h3>
      <div class="product-list__price">¥1,200</div>
      <div class="product-list__stock">在庫あり</div>
    </div>
    <div class="product-list__item">
      <h3 class="product-list__name">Lightning Bolt (Foil)</h3>
      <div class="product-list__price">¥3,500</div>
      <div class="product-list__stock">在庫あり</div>
    </div>
  </div>
</body>
</html>
`;

const MOCK_HTML_NO_RESULT = `
<!DOCTYPE html>
<html lang="ja">
<body>
  <div class="search-no-result">
    <p>検索結果が見つかりませんでした</p>
  </div>
</body>
</html>
`;

const MOCK_HTML_NO_PRICE = `
<!DOCTYPE html>
<html lang="ja">
<body>
  <div class="product-list">
    <div class="product-list__item">
      <h3 class="product-list__name">Some Card</h3>
    </div>
  </div>
</body>
</html>
`;

const MOCK_HTML_EMPTY = `
<!DOCTYPE html>
<html lang="ja">
<body>
  <div class="main-content">
    <p>コンテンツなし</p>
  </div>
</body>
</html>
`;

describe("fetchHareruyaPrice", () => {
  // fetch をモックしてURLパラメータの構築ロジックを検証する
  // 実際のHTTP通信は行わない
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => MOCK_HTML_WITH_PRICE,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockFetch.mockReset();
  });

  describe("URLパラメータの構築", () => {
    it("suggest_type=all と sort=default を固定パラメータとして付与する", async () => {
      await fetchHareruyaPrice("Lightning Bolt", null, null);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("suggest_type")).toBe("all");
      expect(calledUrl.searchParams.get("sort")).toBe("default");
    });

    it("setCode なしの場合はカード名をそのまま product パラメータに渡す", async () => {
      await fetchHareruyaPrice("Lightning Bolt", null, null);

      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("product")).toBe("Lightning Bolt");
    });

    it("setCode のみある場合は 'cardName [setCode]' 形式で product パラメータに渡す", async () => {
      await fetchHareruyaPrice("Lightning Bolt", "M21", null);

      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("product")).toBe("Lightning Bolt [M21]");
    });

    it("collectorNumber と setCode がある場合は '(番号)cardName [setCode]' 形式で product パラメータに渡す", async () => {
      await fetchHareruyaPrice("Lightning Bolt", "TMT", "086");

      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      // Hareruyaの商品タイトルが "(086)《...》[TMT]" 形式のため、同形式で絞り込む
      expect(calledUrl.searchParams.get("product")).toBe("(086)Lightning Bolt [TMT]");
    });

    it("collectorNumber のみある場合は '(番号)cardName' 形式で product パラメータに渡す", async () => {
      await fetchHareruyaPrice("Lightning Bolt", null, "123");

      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("product")).toBe("(123)Lightning Bolt");
    });
  });

  describe("HTTPエラー処理", () => {
    it("レスポンスが ok でない場合は parse_error を返す", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await fetchHareruyaPrice("Lightning Bolt", null, null);

      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("parse_error");
      }
    });

    it("fetch がネットワークエラーをスローした場合は parse_error を返す", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await fetchHareruyaPrice("Lightning Bolt", null, null);

      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("parse_error");
      }
    });

    it("AbortError の場合は再スローする", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      mockFetch.mockRejectedValue(abortError);

      // name が "AbortError" のエラーはキャッチせず呼び出し元に再スローする
      await expect(fetchHareruyaPrice("Lightning Bolt", null, null)).rejects.toMatchObject({
        name: "AbortError",
      });
    });
  });
});

describe("parseHareruyaHtml", () => {
  describe("正常系: 価格取得成功", () => {
    it("最初の商品の価格とカード名を返す", () => {
      const result = parseHareruyaHtml(MOCK_HTML_WITH_PRICE);

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.cardName).toBe("Lightning Bolt");
        expect(result.price).toBe(1200);
        expect(result.currency).toBe("JPY");
      }
    });

    it("カンマ区切りの価格を正しくパースできる", () => {
      const html = `
        <div class="product-list">
          <div class="product-list__item">
            <h3 class="product-list__name">Force of Will</h3>
            <div class="product-list__price">¥8,500</div>
          </div>
        </div>
      `;

      const result = parseHareruyaHtml(html);

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.price).toBe(8500);
      }
    });
  });

  describe("異常系: 価格未発見・パースエラー", () => {
    it("検索結果なし要素がある場合はnot_foundを返す", () => {
      const result = parseHareruyaHtml(MOCK_HTML_NO_RESULT);

      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("not_found");
      }
    });

    it("価格要素がない場合はparse_errorを返す", () => {
      const result = parseHareruyaHtml(MOCK_HTML_NO_PRICE);

      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("parse_error");
      }
    });

    it("商品リスト要素が存在しない場合はparse_errorを返す", () => {
      const result = parseHareruyaHtml(MOCK_HTML_EMPTY);

      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("parse_error");
      }
    });

    it("空のHTMLでもエラーをスローしない", () => {
      expect(() => parseHareruyaHtml("")).not.toThrow();
      const result = parseHareruyaHtml("");
      expect(result.found).toBe(false);
    });
  });
});
