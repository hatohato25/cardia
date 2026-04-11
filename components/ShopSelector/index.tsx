"use client";

import { useState } from "react";
import type { ShopId } from "@/types";

type ShopSelectorProps = {
  onSelect: (shop: ShopId) => void;
};

const SHOPS: { id: ShopId; label: string; description: string }[] = [
  {
    id: "hareruya",
    label: "晴れる屋（MTG）",
    description: "マジック：ザ・ギャザリング専門",
  },
  {
    id: "hareruya2",
    label: "晴れる屋2（ポケカ）",
    description: "ポケモンカードゲーム専門",
  },
];

export default function ShopSelector({ onSelect }: ShopSelectorProps) {
  // デフォルトはhareruya（既存ユーザーの主要ユースケースのため）
  const [selectedShop, setSelectedShop] = useState<ShopId>("hareruya");

  return (
    <div className="flex flex-col items-center justify-center w-full h-full bg-black px-6">
      <h1 className="text-white text-2xl font-bold mb-2">cardia</h1>
      <p className="text-gray-400 text-sm mb-8">検索するショップを選択してください</p>

      <div className="w-full max-w-sm space-y-3">
        {SHOPS.map((shop) => (
          <label
            key={shop.id}
            className={`flex items-center gap-4 w-full text-left bg-gray-900 border rounded-xl px-5 py-4 cursor-pointer transition-colors ${
              selectedShop === shop.id
                ? "border-white bg-gray-800"
                : "border-gray-700 hover:border-gray-500"
            }`}
          >
            <input
              type="radio"
              name="shop"
              value={shop.id}
              checked={selectedShop === shop.id}
              onChange={() => setSelectedShop(shop.id)}
              className="accent-white w-4 h-4 shrink-0"
            />
            <div>
              <p className="text-white font-semibold">{shop.label}</p>
              <p className="text-gray-400 text-sm mt-0.5">{shop.description}</p>
            </div>
          </label>
        ))}
      </div>

      <button
        onClick={() => onSelect(selectedShop)}
        className="mt-8 w-full max-w-sm py-3 bg-white text-black font-bold rounded-xl hover:bg-gray-200 active:scale-95 transition-all"
      >
        開始
      </button>
    </div>
  );
}
