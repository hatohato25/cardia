import { NextRequest, NextResponse } from "next/server";
import { buildCacheKey, getCachedPrice, setCachedPrice } from "@/lib/cache/redis";
import { fetchHareruyaPrice } from "@/lib/parsers/hareruya";
import { fetchHareruya2Price } from "@/lib/parsers/hareruya2";
import type { PriceResponse, ApiError, CachedPrice, ShopId } from "@/types";

function errorResponse(
  message: string,
  status: number
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>(
    { error: message, code: "INTERNAL_ERROR" },
    { status }
  );
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const card = searchParams.get("card");
  const setCode = searchParams.get("set");
  const collectorNumber = searchParams.get("num");
  const shopParam = searchParams.get("shop") ?? "hareruya";

  // cardパラメータは必須
  if (!card || card.trim() === "") {
    return NextResponse.json<ApiError>(
      { error: "card パラメータは必須です", code: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  // shopパラメータのバリデーション
  if (shopParam !== "hareruya" && shopParam !== "hareruya2") {
    return NextResponse.json<ApiError>(
      { error: "shop パラメータは 'hareruya' または 'hareruya2' である必要があります", code: "INVALID_REQUEST" },
      { status: 400 }
    );
  }
  const shop: ShopId = shopParam;

  const cacheKey = buildCacheKey(card, setCode, collectorNumber, shop);

  // Redis キャッシュを確認する（障害時は null が返ってキャッシュスキップ）
  const cachedValue = await getCachedPrice(cacheKey);
  if (cachedValue) {
    const response: PriceResponse = {
      price: cachedValue.price,
      currency: cachedValue.currency,
      source: cachedValue.source,
      cached: true,
      cachedAt: cachedValue.cachedAt,
    };
    return NextResponse.json<PriceResponse>(response);
  }

  // キャッシュミス → ショップ別にフェッチ
  try {
    const parseResult =
      shop === "hareruya2"
        ? await fetchHareruya2Price(card)
        : await fetchHareruyaPrice(card, setCode, collectorNumber);

    console.log(`[/api/price] ${shop} result`, JSON.stringify(parseResult));

    const price = parseResult.found ? parseResult.price : null;
    const now = new Date().toISOString();

    // price: null（未発見）はキャッシュしない（次回リクエストで再取得させる）
    if (price !== null) {
      const cacheValue: CachedPrice = {
        price,
        currency: "JPY",
        source: shop,
        cachedAt: now,
      };
      await setCachedPrice(cacheKey, cacheValue);
    }

    const response: PriceResponse = {
      price,
      currency: "JPY",
      source: shop,
      cached: false,
      cachedAt: now,
    };

    return NextResponse.json<PriceResponse>(response);
  } catch (err) {
    // タイムアウトエラー（AbortError）
    if (err instanceof Error && err.name === "AbortError") {
      console.error("[/api/price] fetch timeout", { card, shop });
      return errorResponse("価格情報の取得がタイムアウトしました", 504);
    }

    console.error("[/api/price] Unexpected error", {
      message: err instanceof Error ? err.message : "Unknown error",
      card,
      shop,
    });
    return errorResponse("価格情報の取得に失敗しました", 500);
  }
}
