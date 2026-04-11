"use client";

import type { PriceResponse } from "@/types";

type PriceTagProps = {
  cardName: string;
  priceResponse: PriceResponse;
};

// 12時間以上前のキャッシュを「古い」と判定する閾値（ミリ秒）
const STALE_CACHE_THRESHOLD_MS = 12 * 60 * 60 * 1000;

const SHOP_LABEL: Record<string, string> = {
  hareruya: "晴れる屋",
  hareruya2: "晴れる屋2",
};

export default function PriceTag({ cardName, priceResponse }: PriceTagProps) {
  const { price, cached, cachedAt, source } = priceResponse;

  // cachedAtが12時間以上前の場合は価格が古い可能性があることを警告する
  const isStaleCache =
    cached &&
    cachedAt !== null &&
    Date.now() - new Date(cachedAt).getTime() > STALE_CACHE_THRESHOLD_MS;

  return (
    <div className="bg-black bg-opacity-75 text-white rounded-lg p-3 max-w-xs">
      <p className="text-sm font-medium text-gray-300 truncate">{cardName}</p>
      <p className="text-2xl font-bold">
        {price !== null ? `¥${price.toLocaleString("ja-JP")}` : "価格未発見"}
      </p>
      <p className="text-xs text-gray-500 mt-0.5">{SHOP_LABEL[source] ?? source}</p>
      {cached && (
        <p
          className={`text-xs mt-1 ${
            isStaleCache ? "text-yellow-400" : "text-gray-400"
          }`}
        >
          {isStaleCache
            ? "(キャッシュ) ※価格が古い可能性があります"
            : "(キャッシュ)"}
        </p>
      )}
    </div>
  );
}
