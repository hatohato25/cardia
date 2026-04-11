"use client";

import { useState } from "react";
import CameraView from "@/components/CameraView";
import ShopSelector from "@/components/ShopSelector";
import type { ShopId } from "@/types";

export default function Home() {
  // null: ショップ未選択（ShopSelectorを表示）
  // ShopId: 選択済み（CameraViewを表示）
  const [selectedShop, setSelectedShop] = useState<ShopId | null>(null);

  return (
    <main className="relative w-full h-screen overflow-hidden bg-black">
      {selectedShop === null ? (
        <ShopSelector onSelect={setSelectedShop} />
      ) : (
        <CameraView selectedShop={selectedShop} />
      )}
    </main>
  );
}
