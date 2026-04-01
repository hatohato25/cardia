import { fetchHareruyaPrice, parseHareruyaApiResponseForTest } from "./hareruya";

// fetchHareruyaPrice のURLパラメータ構築とHTTPエラー処理をテストする
// parseHareruyaApiResponseForTest のレスポンス解析ロジックをテストする

const MOCK_API_RESPONSE_WITH_PRICE = {
  responseHeader: { status: 0, QTime: "3", reqID: "test" },
  response: {
    numFound: 3,
    page: 1,
    docs: [
      {
        product: "112977",
        product_name: "(401)《稲妻/Lightning Bolt》[CLB-BF] 赤C",
        product_name_en: "Lightning Bolt [CLB-BF]",
        card_name: "Lightning Bolt",
        language: "1",
        price: "100",
        foil_flg: "0",
        stock: "504",
        card_condition: "1",
        sale_flg: "0",
      },
      {
        product: "112739",
        product_name: "(187)《稲妻/Lightning Bolt》[CLB] 赤C",
        product_name_en: "Lightning Bolt [CLB]",
        card_name: "Lightning Bolt",
        language: "1",
        price: "200",
        foil_flg: "0",
        stock: "588",
        card_condition: "1",
        sale_flg: "0",
      },
    ],
  },
};

const MOCK_API_RESPONSE_NO_RESULT = {
  responseHeader: { status: 0, QTime: "2", reqID: "test" },
  response: {
    numFound: 0,
    page: 1,
    docs: [],
  },
};

const MOCK_API_RESPONSE_OUT_OF_STOCK_ONLY = {
  responseHeader: { status: 0, QTime: "2", reqID: "test" },
  response: {
    numFound: 1,
    page: 1,
    docs: [
      {
        product: "999",
        product_name: "《Force of Will》[ALL]",
        product_name_en: "Force of Will [ALL]",
        card_name: "Force of Will",
        language: "2",
        price: "15000",
        foil_flg: "0",
        stock: "0",
        card_condition: "1",
        sale_flg: "0",
      },
    ],
  },
};

const MOCK_API_RESPONSE_FOIL_AND_NORMAL = {
  responseHeader: { status: 0, QTime: "2", reqID: "test" },
  response: {
    numFound: 2,
    page: 1,
    docs: [
      {
        product: "100",
        product_name: "【Foil】《Lightning Bolt》[M11]",
        product_name_en: "Lightning Bolt [M11] Foil",
        card_name: "Lightning Bolt",
        language: "2",
        price: "500",
        foil_flg: "1",
        stock: "3",
        card_condition: "1",
        sale_flg: "0",
      },
      {
        product: "101",
        product_name: "《Lightning Bolt》[M11]",
        product_name_en: "Lightning Bolt [M11]",
        card_name: "Lightning Bolt",
        language: "2",
        price: "200",
        foil_flg: "0",
        stock: "5",
        card_condition: "1",
        sale_flg: "0",
      },
    ],
  },
};

const MOCK_API_RESPONSE_API_ERROR = {
  responseHeader: {
    status: 101,
    errorMessage: "invalid sort condition: default",
    QTime: "1",
    reqID: "test",
  },
  response: {
    numFound: 0,
    page: 1,
    docs: [],
  },
};

describe("fetchHareruyaPrice", () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_API_RESPONSE_WITH_PRICE,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockFetch.mockReset();
  });

  describe("URLパラメータの構築", () => {
    it("fq.card_name と fq_category_id=1 と sort=price+asc を付与する", async () => {
      await fetchHareruyaPrice("Lightning Bolt", null, null);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("fq.card_name")).toBe("Lightning Bolt");
      expect(calledUrl.searchParams.get("fq_category_id")).toBe("1");
      // sort パラメータは "price asc" が URL エンコードされて渡る
      expect(calledUrl.searchParams.get("sort")).toBe("price asc");
    });

    it("setCode がある場合は fq.cardset パラメータを付与する", async () => {
      await fetchHareruyaPrice("Lightning Bolt", "M11", null);

      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("fq.cardset")).toBe("M11");
    });

    it("setCode がない場合は fq.cardset パラメータを付与しない", async () => {
      await fetchHareruyaPrice("Lightning Bolt", null, null);

      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.has("fq.cardset")).toBe(false);
    });

    it("collectorNumber がある場合は fq.collector_number パラメータを付与する", async () => {
      await fetchHareruyaPrice("Lightning Bolt", "M11", "149");

      const calledUrl = new URL(mockFetch.mock.calls[0][0] as string);
      expect(calledUrl.searchParams.get("fq.collector_number")).toBe("149");
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

describe("parseHareruyaApiResponseForTest", () => {
  describe("正常系: 価格取得成功", () => {
    it("最安値の非Foil在庫ありカードの価格を返す", () => {
      const result = parseHareruyaApiResponseForTest(
        MOCK_API_RESPONSE_WITH_PRICE,
        "Lightning Bolt"
      );

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.cardName).toBe("Lightning Bolt");
        expect(result.price).toBe(100);
        expect(result.currency).toBe("JPY");
      }
    });

    it("Foilより通常版を優先する", () => {
      const result = parseHareruyaApiResponseForTest(
        MOCK_API_RESPONSE_FOIL_AND_NORMAL,
        "Lightning Bolt"
      );

      expect(result.found).toBe(true);
      if (result.found) {
        // 通常版（foil_flg=0）の価格200が選ばれる（Foil版500より安くても通常版優先）
        expect(result.price).toBe(200);
      }
    });

    it("在庫なしのみの場合は在庫なしカードの価格を返す", () => {
      const result = parseHareruyaApiResponseForTest(
        MOCK_API_RESPONSE_OUT_OF_STOCK_ONLY,
        "Force of Will"
      );

      expect(result.found).toBe(true);
      if (result.found) {
        expect(result.price).toBe(15000);
      }
    });
  });

  describe("異常系: 価格未発見・パースエラー", () => {
    it("検索結果なし（numFound=0）の場合は not_found を返す", () => {
      const result = parseHareruyaApiResponseForTest(
        MOCK_API_RESPONSE_NO_RESULT,
        "Unknown Card"
      );

      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("not_found");
      }
    });

    it("API エラーステータスの場合は parse_error を返す", () => {
      const result = parseHareruyaApiResponseForTest(
        MOCK_API_RESPONSE_API_ERROR,
        "Lightning Bolt"
      );

      expect(result.found).toBe(false);
      if (!result.found) {
        expect(result.reason).toBe("parse_error");
      }
    });
  });
});
