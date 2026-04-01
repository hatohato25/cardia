import * as cheerio from "cheerio";

// Hareruya HTML構造変更時にここだけ修正すればよいようにセレクタを一箇所に集約する
// 実際のHTMLを確認して適切なセレクタに更新する必要がある
const SELECTORS = {
  // 商品リストの各アイテム
  PRODUCT_ITEM: ".product-list__item, .card-list__item, [data-product]",
  // 商品名
  CARD_NAME: ".product-list__name, .card-name, h3.product-name",
  // 価格（税込）
  PRICE: ".product-list__price, .price-normal, .product-price",
  // 在庫状況
  AVAILABILITY: ".product-list__stock, .stock-status",
  // 検索結果なしを示す要素
  NO_RESULT: ".search-no-result, .no-result, .empty-result",
} as const;

// Hareruya 5秒タイムアウト（FR-4-6 要件）
const FETCH_TIMEOUT_MS = 5000;

// 検索URLのベース
const HARERUYA_SEARCH_URL = "https://www.hareruyamtg.com/ja/products/search";

export type HareruyaParseResult =
  | { found: true; cardName: string; price: number; currency: "JPY" }
  | { found: false; reason: "not_found" | "parse_error" };

// Hareruya HTMLから最安値の価格情報を抽出する
export function parseHareruyaHtml(html: string): HareruyaParseResult {
  let $: ReturnType<typeof cheerio.load>;
  try {
    $ = cheerio.load(html);
  } catch {
    return { found: false, reason: "parse_error" };
  }

  // 検索結果なしの判定
  if ($(SELECTORS.NO_RESULT).length > 0) {
    return { found: false, reason: "not_found" };
  }

  // 商品一覧から最初のアイテムを取得する（最安値順でソートされている前提）
  const firstItem = $(SELECTORS.PRODUCT_ITEM).first();
  if (firstItem.length === 0) {
    // セレクタが一致しない場合はparse_errorとして返す
    // HTML構造が変わった可能性がある
    console.warn("[hareruya] Product item selector not found. HTML structure may have changed.");
    return { found: false, reason: "parse_error" };
  }

  const cardNameEl = firstItem.find(SELECTORS.CARD_NAME);
  const priceEl = firstItem.find(SELECTORS.PRICE);

  if (priceEl.length === 0) {
    return { found: false, reason: "parse_error" };
  }

  // 価格テキストから数値を抽出する（例: "¥1,234", "1,234円", "1234"）
  const priceText = priceEl.first().text().trim();
  const price = parsePriceText(priceText);

  if (price === null) {
    console.warn("[hareruya] Price text parsing failed", { priceText });
    return { found: false, reason: "parse_error" };
  }

  const cardName = cardNameEl.first().text().trim();

  return {
    found: true,
    cardName: cardName || "不明",
    price,
    currency: "JPY",
  };
}

// 価格テキストから数値を抽出するユーティリティ
function parsePriceText(text: string): number | null {
  // カンマ・円・¥・税表記などを除去して数値のみ抽出する
  const cleaned = text.replace(/[¥,円\s税込税抜(（)）]/g, "");
  const num = parseInt(cleaned, 10);
  if (isNaN(num) || num < 0) {
    return null;
  }
  return num;
}

// Hareruya 検索ページをフェッチして価格を取得する
export async function fetchHareruyaPrice(
  cardName: string,
  setCode: string | null,
  collectorNumber: string | null
): Promise<HareruyaParseResult> {
  // Hareruyaの商品タイトルは "(コレクター番号)カード名 [セット略号]" 形式のため
  // collectorNumber があれば先頭に "(番号)" を付与して絞り込み精度を上げる
  let productQuery: string;
  if (collectorNumber !== null && setCode !== null) {
    productQuery = `(${collectorNumber})${cardName} [${setCode}]`;
  } else if (collectorNumber !== null) {
    productQuery = `(${collectorNumber})${cardName}`;
  } else if (setCode !== null) {
    productQuery = `${cardName} [${setCode}]`;
  } else {
    productQuery = cardName;
  }

  const params = new URLSearchParams({
    suggest_type: "all",
    product: productQuery,
    sort: "default",
  });

  const url = `${HARERUYA_SEARCH_URL}?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        // Hareruya側がボット検出をしている場合に備えてブラウザ風のUser-Agentを設定する
        "User-Agent":
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      console.error("[hareruya] HTTP error", { status: res.status, cardName });
      return { found: false, reason: "parse_error" };
    }

    const html = await res.text();
    return parseHareruyaHtml(html);
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
