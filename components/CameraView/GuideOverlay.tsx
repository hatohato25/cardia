"use client";

import { useEffect, useRef } from "react";
import type { PriceResponse } from "@/types";

type PriceTagData = {
  cardName: string;
  priceResponse: PriceResponse;
};

type GuideOverlayProps = {
  // 価格タグデータ（取得済みの場合のみ渡す）
  priceTagData: PriceTagData | null;
};

// MTGカードの比率: 63mm × 88mm ≈ 5:7
const CARD_ASPECT_RATIO = 5 / 7;
// ガイド枠の幅は画面幅の70%（縦持ち前提）
const GUIDE_WIDTH_RATIO = 0.7;

// 価格タグの描画スタイル定数
const TAG_STYLE = {
  BACKGROUND: "rgba(0, 0, 0, 0.75)",
  TEXT_COLOR: "#ffffff",
  WARNING_COLOR: "#fbbf24",
  PADDING: 12,
  FONT_CARD_NAME: "bold 16px sans-serif",
  FONT_PRICE: "bold 24px sans-serif",
  FONT_CACHE: "12px sans-serif",
  FONT_WARNING: "11px sans-serif",
  LINE_HEIGHT: 28,
} as const;

export default function GuideOverlay({ priceTagData }: GuideOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // ガイド枠の計算
    const guideWidth = width * GUIDE_WIDTH_RATIO;
    const guideHeight = guideWidth / CARD_ASPECT_RATIO;
    const guideX = (width - guideWidth) / 2;
    const guideY = (height - guideHeight) / 2;

    // ガイド枠の描画
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 2;
    ctx.strokeRect(guideX, guideY, guideWidth, guideHeight);

    // ガイド枠の四隅を強調するコーナーマーカー
    const cornerSize = 20;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 3;

    // 左上
    ctx.beginPath();
    ctx.moveTo(guideX, guideY + cornerSize);
    ctx.lineTo(guideX, guideY);
    ctx.lineTo(guideX + cornerSize, guideY);
    ctx.stroke();

    // 右上
    ctx.beginPath();
    ctx.moveTo(guideX + guideWidth - cornerSize, guideY);
    ctx.lineTo(guideX + guideWidth, guideY);
    ctx.lineTo(guideX + guideWidth, guideY + cornerSize);
    ctx.stroke();

    // 左下
    ctx.beginPath();
    ctx.moveTo(guideX, guideY + guideHeight - cornerSize);
    ctx.lineTo(guideX, guideY + guideHeight);
    ctx.lineTo(guideX + cornerSize, guideY + guideHeight);
    ctx.stroke();

    // 右下
    ctx.beginPath();
    ctx.moveTo(guideX + guideWidth - cornerSize, guideY + guideHeight);
    ctx.lineTo(guideX + guideWidth, guideY + guideHeight);
    ctx.lineTo(guideX + guideWidth, guideY + guideHeight - cornerSize);
    ctx.stroke();

    // 価格タグデータがある場合に描画する
    if (priceTagData) {
      drawPriceTag(ctx, priceTagData, guideX, guideY, guideWidth, guideHeight);
    }
  }, [priceTagData]);

  const handleResize = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  };

  useEffect(() => {
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ width: "100%", height: "100%" }}
    />
  );
}

// ガイド枠下部に価格タグを描画する
function drawPriceTag(
  ctx: CanvasRenderingContext2D,
  data: PriceTagData,
  guideX: number,
  guideY: number,
  guideWidth: number,
  guideHeight: number
): void {
  const { cardName, priceResponse } = data;
  const { price, cached, cachedAt } = priceResponse;

  // キャッシュが12時間以上前の場合は「価格が古い可能性があります」警告を出す
  const isStaleCache =
    cached &&
    cachedAt !== null &&
    Date.now() - new Date(cachedAt).getTime() > 12 * 60 * 60 * 1000;

  const tagX = guideX;
  const tagY = guideY + guideHeight + 8;
  const tagWidth = guideWidth;
  const { PADDING, LINE_HEIGHT } = TAG_STYLE;

  // 表示するテキスト行を構築する
  const lines: Array<{ text: string; font: string; color: string }> = [
    {
      text: cardName,
      font: TAG_STYLE.FONT_CARD_NAME,
      color: TAG_STYLE.TEXT_COLOR,
    },
    {
      text:
        price !== null
          ? `¥${price.toLocaleString("ja-JP")}`
          : "価格未発見",
      font: TAG_STYLE.FONT_PRICE,
      color: TAG_STYLE.TEXT_COLOR,
    },
  ];

  if (cached) {
    lines.push({
      text: isStaleCache
        ? "(キャッシュ) ※価格が古い可能性があります"
        : "(キャッシュ)",
      font: TAG_STYLE.FONT_CACHE,
      color: isStaleCache ? TAG_STYLE.WARNING_COLOR : TAG_STYLE.TEXT_COLOR,
    });
  }

  const tagHeight = PADDING * 2 + lines.length * LINE_HEIGHT;

  // 背景描画
  ctx.fillStyle = TAG_STYLE.BACKGROUND;
  ctx.fillRect(tagX, tagY, tagWidth, tagHeight);

  // テキスト描画
  lines.forEach((line, index) => {
    ctx.font = line.font;
    ctx.fillStyle = line.color;
    ctx.fillText(
      line.text,
      tagX + PADDING,
      tagY + PADDING + index * LINE_HEIGHT + 18
    );
  });
}
