import * as cheerio from "cheerio";

// hareruya2 5秒タイムアウト
const FETCH_TIMEOUT_MS = 5000;

// hareruya2 検索URL（Shopifyベースのポケモンカード専売ストア）
const HARERUYA2_SEARCH_URL = "https://www.hareruya2.com/search";

export type Hareruya2ParseResult =
  | { found: true; cardName: string; price: number; currency: "JPY" }
  | { found: false; reason: "not_found" | "parse_error" };

// Shopify Products JSON API のレスポンス型（価格取得に使用）
type ShopifyProductJson = {
  product: {
    title: string;
    variants: Array<{
      price: string;
    }>;
  };
};

// hareruya2 検索→価格取得フロー:
// 1. /search?q={cardName} または /search?q={cardName NNN/NNN} のHTMLからproductハンドルを取得（cheerioでスクレイピング）
// 2. /products/{handle}.json のShopify APIから価格を取得（JSON APIなのでパース安定）
export async function fetchHareruya2Price(
  cardName: string,
  collectorNumber: string | null
): Promise<Hareruya2ParseResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    // Step1: 検索HTMLから最初の商品ハンドルを取得する
    const handle = await fetchFirstProductHandle(cardName, collectorNumber, controller.signal);
    if (!handle) {
      // OCRがカード名を誤読した場合でもコレクター番号はhareruya2の商品名に含まれる可能性があるため
      // コレクター番号のみで再検索してヒット率を上げる
      if (collectorNumber !== null) {
        console.log("[hareruya2] fallback search by collector number only");
        const fallbackHandle = await fetchFirstProductHandle(collectorNumber, null, controller.signal);
        if (!fallbackHandle) {
          return { found: false, reason: "not_found" };
        }
        // フォールバック時もrequstedCardNameはOCRで読み取ったカード名を引き継ぐ
        // fetchProductPrice内でproduct.titleにより上書きされるため問題ない
        return await fetchProductPrice(fallbackHandle, cardName, controller.signal);
      }
      return { found: false, reason: "not_found" };
    }

    // Step2: Shopify Products JSON APIで価格を取得する
    // HTMLスクレイピングは構造変化に弱いため、安定したJSON APIを使う
    const result = await fetchProductPrice(handle, cardName, controller.signal);
    return result;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    console.error("[hareruya2] Fetch error", {
      message: err instanceof Error ? err.message : "Unknown error",
      cardName,
    });
    return { found: false, reason: "parse_error" };
  } finally {
    clearTimeout(timeoutId);
  }
}

// 検索結果HTMLの最初の .card-wrapper a[href="/products/..."] からハンドルを取得する
async function fetchFirstProductHandle(
  cardName: string,
  collectorNumber: string | null,
  signal: AbortSignal
): Promise<string | null> {
  // collectorNumber がある場合は "カード名 NNN/NNN" 形式で検索して絞り込む
  // コレクター番号なしだと同名の別バリアント（通常版/AR等）が混在するため
  const query = collectorNumber ? `${cardName} ${collectorNumber}` : cardName;
  const params = new URLSearchParams({ q: query });
  const url = `${HARERUYA2_SEARCH_URL}?${params.toString()}`;
  console.log("[hareruya2] search URL:", url);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "ja-JP,ja;q=0.9",
    },
    signal,
  });

  if (!res.ok) {
    console.error("[hareruya2] Search HTTP error", {
      status: res.status,
      cardName,
    });
    return null;
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // .card-wrapper の中の a タグ href から /products/{handle} を抽出する
  // 同じハンドルが複数出現するため最初の1件のみ使用する
  let handle: string | null = null;
  $(".card-wrapper a[href]").each((_i, el) => {
    if (handle) return false; // 最初の1件で停止
    const href = $(el).attr("href") ?? "";
    const match = /^\/products\/([^/?#]+)/.exec(href);
    if (match) {
      handle = match[1];
    }
  });

  return handle;
}

// Shopify の /products/{handle}.json から価格を取得する
// variants[0].price に最初のバリアントの価格が入っている（単位: 円の文字列）
async function fetchProductPrice(
  handle: string,
  requestedCardName: string,
  signal: AbortSignal
): Promise<Hareruya2ParseResult> {
  const url = `https://www.hareruya2.com/products/${handle}.json`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      Accept: "application/json",
    },
    signal,
  });

  if (!res.ok) {
    console.error("[hareruya2] Product JSON HTTP error", {
      status: res.status,
      handle,
    });
    return { found: false, reason: "parse_error" };
  }

  const data = (await res.json()) as ShopifyProductJson;
  const variant = data.product.variants[0];

  if (!variant) {
    return { found: false, reason: "not_found" };
  }

  const price = parseInt(variant.price, 10);
  if (isNaN(price) || price < 0) {
    console.warn("[hareruya2] Invalid price value", {
      price: variant.price,
      handle,
    });
    return { found: false, reason: "parse_error" };
  }

  // product.title にカード名が入っている（例: "ナンジャモのカイデン(-){雷}〈278/742〉[MC]"）
  const cardName =
    data.product.title.length > 0 ? data.product.title : requestedCardName;

  return {
    found: true,
    cardName,
    price,
    currency: "JPY",
  };
}
