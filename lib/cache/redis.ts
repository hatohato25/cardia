import { Redis } from "@upstash/redis";
import type { CachedPrice } from "@/types";

// 24時間キャッシュ（Hareruya価格は日次更新のため、無料枠節約も兼ねる）
export const CACHE_TTL_SEC = 60 * 60 * 24;

let redisClient: Redis | null = null;

// Redis クライアントを遅延初期化する（環境変数が揃っている場合のみ接続）
function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    // 環境変数未設定時はキャッシュをスキップするため null を返す
    return null;
  }

  redisClient = new Redis({ url, token });
  return redisClient;
}

// キャッシュキー設計: "price:{cardName}:{setCode}:{collectorNumber}"
// setCode / collectorNumber が null の場合は "_" でプレースホルダ
export function buildCacheKey(
  cardName: string,
  setCode: string | null,
  collectorNumber: string | null
): string {
  return `price:${cardName}:${setCode ?? "_"}:${collectorNumber ?? "_"}`;
}

// Redis障害時はnullを返してキャッシュをスキップする（NFR-4 デグレード許容）
export async function getCachedPrice(key: string): Promise<CachedPrice | null> {
  const redis = getRedisClient();
  if (!redis) return null;

  try {
    const value = await redis.get<CachedPrice>(key);
    if (value) {
      console.info("[/api/price] cache hit", { key, cachedAt: value.cachedAt });
    }
    return value;
  } catch (err) {
    // Redis障害はログに留めてキャッシュスキップ
    console.error("[cache] Redis get error", {
      key,
      message: err instanceof Error ? err.message : "Unknown error",
    });
    return null;
  }
}

// Redis障害時はログのみでエラーをスローしない（NFR-4 デグレード許容）
export async function setCachedPrice(
  key: string,
  value: CachedPrice
): Promise<void> {
  const redis = getRedisClient();
  if (!redis) return;

  try {
    await redis.set(key, value, { ex: CACHE_TTL_SEC });
  } catch (err) {
    // Redis障害はログに留める（Hareruya直接フェッチにフォールバックされる）
    console.error("[cache] Redis set error", {
      key,
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
}
