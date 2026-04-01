import type { WorkerInMessage, WorkerOutMessage } from "@/types";

// OffscreenCanvas 未サポート環境（iOS 16未満など）ではこのWorkerは動作しない
// その場合はメインスレッド側がフォールバックに切り替える設計
if (typeof OffscreenCanvas === "undefined") {
  const errorMsg: WorkerOutMessage = {
    type: "ERROR",
    message: "OffscreenCanvas is not supported in this environment",
  };
  self.postMessage(errorMsg);
}

let captureIntervalId: ReturnType<typeof setInterval> | null = null;
let offscreenCanvas: OffscreenCanvas | null = null;

// MTGカードの比率: 63mm × 88mm ≈ 5:7
const CARD_ASPECT_RATIO = 5 / 7;
// ガイド枠の幅はcanvas幅の70%（縦持ち前提）
const GUIDE_WIDTH_RATIO = 0.7;

function stopCapture(): void {
  if (captureIntervalId !== null) {
    clearInterval(captureIntervalId);
    captureIntervalId = null;
  }
}

async function captureFrame(): Promise<void> {
  if (!offscreenCanvas) {
    const errorMsg: WorkerOutMessage = {
      type: "ERROR",
      message: "OffscreenCanvas が設定されていません",
    };
    self.postMessage(errorMsg);
    return;
  }

  const ctx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    const errorMsg: WorkerOutMessage = {
      type: "ERROR",
      message: "CanvasRenderingContext2D の取得に失敗しました",
    };
    self.postMessage(errorMsg);
    return;
  }

  const width = offscreenCanvas.width;
  const height = offscreenCanvas.height;

  // ガイド枠領域を計算して切り出す
  const guideWidth = width * GUIDE_WIDTH_RATIO;
  const guideHeight = guideWidth / CARD_ASPECT_RATIO;
  const guideX = (width - guideWidth) / 2;
  const guideY = (height - guideHeight) / 2;

  // ガイド枠領域のみを切り出す用の一時Canvasを作成
  const cropCanvas = new OffscreenCanvas(guideWidth, guideHeight);
  const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true });
  if (!cropCtx) {
    const errorMsg: WorkerOutMessage = {
      type: "ERROR",
      message: "切り出し用Canvasのコンテキスト取得に失敗しました",
    };
    self.postMessage(errorMsg);
    return;
  }

  cropCtx.drawImage(
    offscreenCanvas,
    guideX,
    guideY,
    guideWidth,
    guideHeight,
    0,
    0,
    guideWidth,
    guideHeight
  );

  try {
    const blob = await cropCanvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    const arrayBuffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const frameMsg: WorkerOutMessage = {
      type: "FRAME",
      imageBase64: `data:image/jpeg;base64,${base64}`,
    };
    self.postMessage(frameMsg);
  } catch (err) {
    const errorMsg: WorkerOutMessage = {
      type: "ERROR",
      message: err instanceof Error ? err.message : "フレームのBlobへの変換に失敗しました",
    };
    self.postMessage(errorMsg);
  }
}

// ArrayBuffer をBase64文字列に変換するユーティリティ
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

self.onmessage = (e: MessageEvent<WorkerInMessage | { type: "INIT_CANVAS"; canvas: OffscreenCanvas }>) => {
  const data = e.data;

  if (data.type === "INIT_CANVAS") {
    offscreenCanvas = data.canvas;
  } else if (data.type === "START") {
    stopCapture();
    captureIntervalId = setInterval(() => {
      captureFrame().catch((err: unknown) => {
        const errorMsg: WorkerOutMessage = {
          type: "ERROR",
          message: err instanceof Error ? err.message : "キャプチャ処理でエラーが発生しました",
        };
        self.postMessage(errorMsg);
      });
    }, data.intervalMs);
  } else if (data.type === "STOP") {
    stopCapture();
  }
};
