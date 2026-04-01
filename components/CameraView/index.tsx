"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { WorkerInMessage, WorkerOutMessage, OcrResponse, PriceResponse } from "@/types";
import { useCameraStream } from "./useCameraStream";
import GuideOverlay from "./GuideOverlay";

type PriceTagData = {
  cardName: string;
  priceResponse: PriceResponse;
};

type FetchStatus =
  | "idle"
  | "searching"
  | "found"
  | "not_found"
  | "error";

export default function CameraView() {
  const workerRef = useRef<Worker | null>(null);
  const { videoRef, cameraState, requestCamera } = useCameraStream(workerRef);
  const offscreenTransferredRef = useRef(false);

  // OCRリクエスト多重送信防止フラグ
  const isOcrPendingRef = useRef(false);
  // レート制限受信時のOCRスキップ管理
  const rateLimitedUntilRef = useRef<number | null>(null);
  // GCP障害時のリトライ管理
  const ocrRetryCountRef = useRef(0);
  const MAX_OCR_RETRY = 3;

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [priceTagData, setPriceTagData] = useState<PriceTagData | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // OCR→価格検索フローを実行する
  const handleFrame = useCallback(async (imageBase64: string) => {
    // レート制限中はOCRをスキップ
    if (rateLimitedUntilRef.current !== null && Date.now() < rateLimitedUntilRef.current) {
      return;
    }

    isOcrPendingRef.current = true;
    setFetchStatus("searching");
    setStatusMessage("検索中...");

    let ocrResponse: OcrResponse;
    try {
      ocrResponse = await callOcrApi(imageBase64);
      ocrRetryCountRef.current = 0;
    } catch (err) {
      const error = err as { code?: string };

      // レート制限（429）時は5秒間OCRをスキップ
      if (error.code === "RATE_LIMITED") {
        rateLimitedUntilRef.current = Date.now() + 5000;
        setStatusMessage("リクエストが多すぎます。しばらくお待ちください");
        setFetchStatus("error");
        isOcrPendingRef.current = false;
        return;
      }

      // GCP障害（502/504）時は500ms後に最大3回リトライ
      if (error.code === "OCR_FAILED" || error.code === "OCR_TIMEOUT") {
        if (ocrRetryCountRef.current < MAX_OCR_RETRY) {
          ocrRetryCountRef.current++;
          await sleep(500);
          isOcrPendingRef.current = false;
          // 次フレームで再試行させるためここで終了
          return;
        }
        setStatusMessage("OCRサービスが一時的に利用できません");
        setFetchStatus("error");
        isOcrPendingRef.current = false;
        return;
      }

      setStatusMessage("OCR処理でエラーが発生しました");
      setFetchStatus("error");
      isOcrPendingRef.current = false;
      return;
    }

    // カード名が取得できなかった場合はスキップ
    if (!ocrResponse.cardName) {
      setStatusMessage("カードを認識できません。枠内に合わせてください");
      setFetchStatus("not_found");
      isOcrPendingRef.current = false;
      return;
    }

    const { cardName, setCode, collectorNumber } = ocrResponse;

    // 価格検索APIを呼ぶ
    try {
      const priceResponse = await callPriceApi(cardName, setCode, collectorNumber);

      // キャッシュが12時間以上前の場合は警告フラグを立てる（GuideOverlayで判定）
      setPriceTagData({ cardName, priceResponse });
      setFetchStatus(priceResponse.price !== null ? "found" : "not_found");
      setStatusMessage(null);
    } catch {
      setStatusMessage("価格情報の取得に失敗しました");
      setFetchStatus("error");
    }

    isOcrPendingRef.current = false;
  }, []);

  // Workerを起動してキャプチャを開始する
  const startWorkerCapture = useCallback((canvas: HTMLCanvasElement) => {
    if (typeof OffscreenCanvas === "undefined") {
      // OffscreenCanvas未サポート環境（iOS 16未満等）ではメインスレッドフォールバックを使う
      startMainThreadCapture(canvas, handleFrame);
      return;
    }

    // OffscreenCanvasをWorkerに渡す（transferControlToOffscreen後はメインスレッドから操作不可）
    if (!offscreenTransferredRef.current) {
      const offscreen = canvas.transferControlToOffscreen();
      offscreenTransferredRef.current = true;

      const worker = new Worker(
        new URL("../../workers/frameCapture.worker.ts", import.meta.url)
      );
      workerRef.current = worker;

      worker.postMessage({ type: "INIT_CANVAS", canvas: offscreen }, [offscreen]);

      worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
        const msg = e.data;
        if (msg.type === "FRAME") {
          // 多重送信防止: 前のリクエストが完了するまで次フレームをスキップ
          if (!isOcrPendingRef.current) {
            handleFrame(msg.imageBase64).catch(() => {
              isOcrPendingRef.current = false;
            });
          }
        } else if (msg.type === "ERROR") {
          if (msg.message.includes("OffscreenCanvas is not supported")) {
            // OffscreenCanvas未サポートエラーをWorkerから受け取ったらフォールバックへ
            worker.terminate();
            workerRef.current = null;
            startMainThreadCapture(canvas, handleFrame);
          }
          // その他のエラーはログに留め、次フレームで再試行
          console.error("[Worker] Error:", msg.message);
        }
      };

      const startMsg: WorkerInMessage = { type: "START", intervalMs: 500 };
      worker.postMessage(startMsg);
    }
  }, [handleFrame]);

  // OffscreenCanvas用のcanvasを動画ソースとして描画する別のcanvasが必要
  // videoから直接transferControlToOffscreenはできないため、
  // videoフレームをcanvasに描画してからWorkerに渡す
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startDrawingVideoToCanvas = useCallback(() => {
    const video = videoRef.current;
    const canvas = drawingCanvasRef.current;
    if (!video || !canvas) return;

    // videoのサイズに合わせてcanvasをリサイズ
    const updateCanvasSize = () => {
      if (video.videoWidth > 0) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
    };

    updateCanvasSize();

    // 33ms間隔（約30fps）でvideoフレームをcanvasに描画する
    drawIntervalRef.current = setInterval(() => {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        updateCanvasSize();
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(video, 0, 0);
        }
      }
    }, 33);
  }, [videoRef]);

  useEffect(() => {
    if (cameraState.status === "streaming") {
      startDrawingVideoToCanvas();
      const canvas = drawingCanvasRef.current;
      if (canvas) {
        startWorkerCapture(canvas);
      }
    }

    return () => {
      if (drawIntervalRef.current) {
        clearInterval(drawIntervalRef.current);
        drawIntervalRef.current = null;
      }
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      offscreenTransferredRef.current = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState.status]);

  // 初回マウント時にカメラを起動する
  useEffect(() => {
    requestCamera();
  }, [requestCamera]);

  if (cameraState.status === "error") {
    return (
      <div className="flex items-center justify-center w-full h-full">
        <div className="bg-black bg-opacity-80 text-white rounded-lg p-6 max-w-sm mx-4 text-center">
          <p className="text-lg font-bold mb-2">カメラを起動できません</p>
          <p className="text-sm text-gray-300">
            {getCameraErrorMessage(cameraState.reason)}
          </p>
          {cameraState.reason !== "not_https" && (
            <button
              onClick={() => requestCamera()}
              className="mt-4 px-4 py-2 bg-white text-black rounded font-bold"
            >
              再試行
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* カメラ映像 */}
      <video
        ref={videoRef}
        className="absolute inset-0 w-full h-full object-cover"
        playsInline
        muted
        autoPlay
      />

      {/* OffscreenCanvas転送用の非表示canvas（videoフレームをWorkerに渡すための中継） */}
      <canvas
        ref={drawingCanvasRef}
        className="hidden"
      />

      {/* OCRガイド枠と価格タグのオーバーレイ */}
      <div className="absolute inset-0">
        <GuideOverlay priceTagData={priceTagData} />
      </div>

      {/* 検索中スピナー（DOM オーバーレイ、Canvas外） */}
      {fetchStatus === "searching" && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black bg-opacity-70 text-white px-4 py-2 rounded-full">
          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">検索中...</span>
        </div>
      )}

      {/* エラー・ステータスメッセージ */}
      {statusMessage && fetchStatus !== "searching" && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-black bg-opacity-70 text-white px-4 py-2 rounded-lg text-sm max-w-xs text-center">
          {statusMessage}
        </div>
      )}

      {/* カメラ権限リクエスト中の表示 */}
      {cameraState.status === "requesting" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
          <p className="text-white text-lg">カメラを起動しています...</p>
        </div>
      )}
    </div>
  );
}

// メインスレッドフォールバック: OffscreenCanvas未サポート時のキャプチャ実装
let mainThreadIntervalId: ReturnType<typeof setInterval> | null = null;

function startMainThreadCapture(
  canvas: HTMLCanvasElement,
  onFrame: (imageBase64: string) => Promise<void>
): void {
  if (mainThreadIntervalId !== null) {
    clearInterval(mainThreadIntervalId);
  }

  let isPending = false;

  mainThreadIntervalId = setInterval(() => {
    if (isPending) return;

    // JPEG品質0.8でキャプチャ（FR-2-4の要件）
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.8);
    if (imageBase64 === "data:,") return; // 空フレームをスキップ

    isPending = true;
    onFrame(imageBase64)
      .catch(() => {})
      .finally(() => {
        isPending = false;
      });
  }, 500);
}

async function callOcrApi(imageBase64: string): Promise<OcrResponse> {
  const res = await fetch("/api/ocr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageBase64 }),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ code: "INTERNAL_ERROR", error: "不明なエラー" }));
    const err = new Error(errData.error ?? "OCR APIエラー") as Error & { code?: string };
    err.code = errData.code;
    throw err;
  }

  return res.json() as Promise<OcrResponse>;
}

async function callPriceApi(
  cardName: string,
  setCode: string | null,
  collectorNumber: string | null
): Promise<PriceResponse> {
  const params = new URLSearchParams({ card: cardName });
  if (setCode) params.set("set", setCode);
  if (collectorNumber) params.set("num", collectorNumber);

  const res = await fetch(`/api/price?${params.toString()}`);

  if (!res.ok) {
    const errData = await res.json().catch(() => ({ error: "価格API エラー" }));
    throw new Error(errData.error ?? "価格APIエラー");
  }

  return res.json() as Promise<PriceResponse>;
}

function getCameraErrorMessage(reason: string): string {
  switch (reason) {
    case "permission_denied":
      return "カメラへのアクセスを許可してください。ブラウザの設定からカメラの権限を有効にしてください。";
    case "not_https":
      return "HTTPS環境が必要です。このアプリはHTTPS接続でのみ動作します。";
    case "device_not_found":
      return "カメラデバイスが見つかりません。カメラが接続されていることを確認してください。";
    default:
      return "カメラの起動に失敗しました。ブラウザを再読み込みしてください。";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
