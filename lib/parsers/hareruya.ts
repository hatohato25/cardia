// HareruyaはページのHTMLをAjaxで動的ロードするため、静的HTMLパースは機能しない
// 代わりに内部JSON APIエンドポイント（/ja/products/search/unisearch_api）を使用する

// Hareruya 5秒タイムアウト（FR-4-6 要件）
const FETCH_TIMEOUT_MS = 5000;

// Hareruya 内部JSON APIのベースURL
const HARERUYA_API_URL =
  "https://www.hareruyamtg.com/ja/products/search/unisearch_api";

export type HareruyaParseResult =
  | { found: true; cardName: string; price: number; currency: "JPY" }
  | { found: false; reason: "not_found" | "parse_error" };

// HareruyaのJSON APIレスポンスのdocフィールド型
type HareruyaDoc = {
  product: string;
  product_name: string;
  product_name_en: string;
  card_name: string;
  language: string;
  price: string;
  foil_flg: string;
  stock: string;
  card_condition: string;
  sale_flg: string;
};

type HareruyaApiResponse = {
  responseHeader: {
    status: number;
    errorMessage?: string;
  };
  response: {
    numFound: number;
    docs: HareruyaDoc[];
    page: number;
  };
};

// Hareruya JSON APIを呼び出してカード価格を取得する
// fq.card_name: カード名での完全一致絞り込み
// fq_category_id=1: カード（シングル）カテゴリに絞り込み
// sort=price+asc: 価格昇順（最安値が先頭に来る）
export async function fetchHareruyaPrice(
  cardName: string,
  setCode: string | null,
  collectorNumber: string | null
): Promise<HareruyaParseResult> {
  const params = new URLSearchParams({
    // kwがHareruyaの実際のキーワード検索パラメータ（fq.card_nameは機能しない）
    kw: cardName,
    // 価格1円以上に絞り込む（0円の未設定商品を除外）
    "fq.price": "1~*",
    // シングルカードカテゴリに限定
    fq_category_id: "1",
    // 価格昇順で最安値を先頭に
    sort: "price asc",
    // アートカード含む全バリアントを取得してフィルタリング
    rows: "20",
  });

  // セット略号がある場合は絞り込みに使う
  if (setCode !== null) {
    params.set("fq.cardset", setCode);
  }

  // collectorNumberはAPIパラメータでは絞り込めないため、レスポンスのフィルタリングで使用する

  const url = `${HARERUYA_API_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        // Hareruya側がボット検出をしている場合に備えてブラウザ風のUser-Agentを設定する
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: "https://www.hareruyamtg.com/ja/products/search",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[hareruya] HTTP error", { status: res.status, cardName });
      return { found: false, reason: "parse_error" };
    }

    const data = (await res.json()) as HareruyaApiResponse;
    return parseHareruyaApiResponse(data, cardName, collectorNumber);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      // タイムアウトエラーは呼び出し元で適切に処理するために再スロー
      throw err;
    }
    console.error("[hareruya] Fetch error", {
      message: err instanceof Error ? err.message : "Unknown error",
      cardName,
    });
    return { found: false, reason: "parse_error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

// HareruyaのJSON APIレスポンスから価格情報を抽出する
// collectorNumber: OCRで取得したコレクター番号（例: "010"）。通常版カードの絞り込みに使用
function parseHareruyaApiResponse(
  data: HareruyaApiResponse,
  requestedCardName: string,
  collectorNumber: string | null
): HareruyaParseResult {
  if (data.responseHeader.status !== 0) {
    console.warn("[hareruya] API error status", {
      status: data.responseHeader.status,
      message: data.responseHeader.errorMessage,
    });
    return { found: false, reason: "parse_error" };
  }

  if (data.response.numFound === 0 || data.response.docs.length === 0) {
    return { found: false, reason: "not_found" };
  }

  // アートカード・トークン等の非通常版を除外する
  // 通常版カードのproduct_nameは《》形式のカード名を含む
  const normalCards = data.response.docs.filter((doc) =>
    doc.product_name.includes("《")
  );
  const docsToSearch = normalCards.length > 0 ? normalCards : data.response.docs;

  // コレクター番号がある場合はproduct_nameの "(NNN)" パターンで絞り込む
  // 例: collectorNumber="010" → "(010)" を含む商品に絞る
  const collectorFiltered =
    collectorNumber !== null
      ? docsToSearch.filter((doc) =>
          doc.product_name.includes(`(${collectorNumber})`)
        )
      : docsToSearch;
  const filteredDocs = collectorFiltered.length > 0 ? collectorFiltered : docsToSearch;

  // 在庫ありの通常版（非Foil）を優先して検索する
  // 在庫なしの場合は在庫なし含めて最安値を返す
  const inStockNonFoil = filteredDocs.filter(
    (doc) => doc.stock !== "0" && doc.foil_flg === "0"
  );
  const inStock = filteredDocs.filter((doc) => doc.stock !== "0");
  const candidates =
    inStockNonFoil.length > 0
      ? inStockNonFoil
      : inStock.length > 0
        ? inStock
        : filteredDocs;

  // 価格昇順ソート済みのためcandidates[0]が最安値
  const cheapest = candidates[0];
  if (!cheapest) {
    return { found: false, reason: "not_found" };
  }

  const price = parseInt(cheapest.price, 10);
  if (isNaN(price) || price < 0) {
    console.warn("[hareruya] Invalid price value", { price: cheapest.price });
    return { found: false, reason: "parse_error" };
  }

  // APIはcard_nameフィールドにカード名の英語表記を持つ
  // リクエストしたカード名と同じかAPIから返されたカード名を使用する
  const returnedCardName =
    cheapest.card_name.length > 0 ? cheapest.card_name : requestedCardName;

  return {
    found: true,
    cardName: returnedCardName,
    price,
    currency: "JPY",
  };
}

// 後方互換性のためにHTML解析関数を残すが、実際のフェッチには使わない
// テスト目的で内部パース関数をエクスポートする
export function parseHareruyaApiResponseForTest(
  data: HareruyaApiResponse,
  requestedCardName: string,
  collectorNumber: string | null = null
): HareruyaParseResult {
  return parseHareruyaApiResponse(data, requestedCardName, collectorNumber);
}
