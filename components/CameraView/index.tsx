"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { OcrResponse, PriceResponse } from "@/types";
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

// 静止検出の設定定数
const STABILITY_THRESHOLD = 8;        // ピクセル差分の閾値（調整可能）
const STABILITY_FRAMES = 5;           // 安定と判定するフレーム数
const POST_SEARCH_COOLDOWN_MS = 3000; // 検索後のクールダウン

export default function CameraView() {
  const workerRef = useRef<Worker | null>(null);
  const { videoRef, cameraState, requestCamera } = useCameraStream(workerRef);

  // OCRリクエスト多重送信防止フラグ
  const isOcrPendingRef = useRef(false);
  // レート制限受信時のOCRスキップ管理
  const rateLimitedUntilRef = useRef<number | null>(null);
  // GCP障害時のリトライ管理
  const ocrRetryCountRef = useRef(0);
  const MAX_OCR_RETRY = 3;

  // フロントキャッシュ: カード名 → 価格タグデータのMap
  const priceCache = useRef<Map<string, PriceTagData>>(new Map());

  // 手動タップ時にOCRを即実行するためのトリガー関数をRefで保持
  // startMainThreadCapture内のクロージャから参照するため
  const manualTriggerRef = useRef<(() => void) | null>(null);

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [priceTagData, setPriceTagData] = useState<PriceTagData | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // OCR→価格検索フローを実行する
  // imageBase64: キャプチャした画像のBase64文字列
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

    // フロントキャッシュにヒットすれば価格APIをスキップして即表示
    const cached = priceCache.current.get(cardName);
    if (cached) {
      setPriceTagData(cached);
      setFetchStatus(cached.priceResponse.price !== null ? "found" : "not_found");
      setStatusMessage(null);
      isOcrPendingRef.current = false;
      return;
    }

    // 価格検索APIを呼ぶ
    try {
      const priceResponse = await callPriceApi(cardName, setCode, collectorNumber);

      // キャッシュが12時間以上前の場合は警告フラグを立てる（GuideOverlayで判定）
      const newPriceTagData: PriceTagData = { cardName, priceResponse };
      priceCache.current.set(cardName, newPriceTagData);
      setPriceTagData(newPriceTagData);
      setFetchStatus(priceResponse.price !== null ? "found" : "not_found");
      setStatusMessage(null);
    } catch {
      setStatusMessage("価格情報の取得に失敗しました");
      setFetchStatus("error");
    }

    isOcrPendingRef.current = false;
  }, []);

  // キャプチャを開始する（メインスレッドで実行、OffscreenCanvas分離は将来フェーズ）
  // transferControlToOffscreen後はcanvasのwidthが0になり映像が取れないため
  // 現時点はcanvas.toDataURLベースのメインスレッドキャプチャに統一する
  const startWorkerCapture = useCallback((canvas: HTMLCanvasElement) => {
    const trigger = startMainThreadCapture(canvas, handleFrame);
    manualTriggerRef.current = trigger;
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
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraState.status]);

  // 初回マウント時にカメラを起動する
  useEffect(() => {
    requestCamera();
  }, [requestCamera]);

  // ガイド枠タップ時にOCRを即実行する
  const handleGuideAreaTap = useCallback(() => {
    if (manualTriggerRef.current) {
      manualTriggerRef.current();
    }
  }, []);

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
        <GuideOverlay
          priceTagData={priceTagData}
          fetchStatus={fetchStatus}
          onGuideAreaTap={handleGuideAreaTap}
        />
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
// 静止検出を組み込み、フレームが安定したときのみOCRリクエストを送信する
// 戻り値はmanualTrigger関数（タップ時に即ORC実行するため）
let mainThreadIntervalId: ReturnType<typeof setInterval> | null = null;

function startMainThreadCapture(
  canvas: HTMLCanvasElement,
  onFrame: (imageBase64: string) => Promise<void>
): () => void {
  if (mainThreadIntervalId !== null) {
    clearInterval(mainThreadIntervalId);
  }

  let isPending = false;
  // 検索後のクールダウンタイム（静止検出を一時停止する期限）
  let cooldownUntil = 0;
  // 直近フレームの差分履歴（STABILITY_FRAMES本分保持）
  const diffHistory: number[] = [];
  // 前フレームのImageData（静止検出の比較対象）
  let prevImageData: ImageData | null = null;
  // 静止検出をスキップして即OCRを実行するフラグ
  let manualTriggerPending = false;

  // 差分計算用の小さいcanvas（負荷削減のため64x64にリサイズして比較）
  const diffCanvas = document.createElement("canvas");
  diffCanvas.width = 64;
  diffCanvas.height = 64;
  const diffCtx = diffCanvas.getContext("2d");

  // 現在のcanvasフレームをリサイズしてImageDataを取得するヘルパー
  const getResizedImageData = (): ImageData | null => {
    if (!diffCtx) return null;
    diffCtx.drawImage(canvas, 0, 0, 64, 64);
    return diffCtx.getImageData(0, 0, 64, 64);
  };

  mainThreadIntervalId = setInterval(() => {
    if (isPending) return;
    // 空フレームはスキップ（カメラ未起動時など）
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.8);
    if (imageBase64 === "data:,") return;

    const now = Date.now();

    // 手動タップトリガーが発火していれば静止検出をバイパスしてすぐOCRを実行
    if (manualTriggerPending) {
      manualTriggerPending = false;
      // タップ後はクールダウンを設定して次の静止検出まで待機させる
      cooldownUntil = now + POST_SEARCH_COOLDOWN_MS;
      prevImageData = null;
      diffHistory.length = 0;

      isPending = true;
      onFrame(imageBase64)
        .catch(() => {})
        .finally(() => {
          isPending = false;
        });
      return;
    }

    // クールダウン中は静止検出をスキップ
    if (now < cooldownUntil) {
      return;
    }

    // フレーム差分を計算して安定性を判定する
    const curr = getResizedImageData();
    if (curr && prevImageData) {
      const diff = calcFrameDiff(prevImageData, curr);
      diffHistory.push(diff);
      // 直近STABILITY_FRAMES本分のみ保持
      if (diffHistory.length > STABILITY_FRAMES) {
        diffHistory.shift();
      }

      // STABILITY_FRAMES本すべての差分が閾値以下なら「安定」と判定してOCRを実行
      if (
        diffHistory.length === STABILITY_FRAMES &&
        diffHistory.every((d) => d <= STABILITY_THRESHOLD)
      ) {
        // 安定検出後はクールダウンを設定して連続送信を防ぐ
        cooldownUntil = now + POST_SEARCH_COOLDOWN_MS;
        prevImageData = null;
        diffHistory.length = 0;

        isPending = true;
        onFrame(imageBase64)
          .catch(() => {})
          .finally(() => {
            isPending = false;
          });
        return;
      }
    }

    prevImageData = curr;
  }, 500);

  // 手動タップ用トリガー関数を返す
  // 呼び出し側はこれをRefに保持してタップイベントで呼び出す
  return () => {
    manualTriggerPending = true;
  };
}

// canvas から ImageData を取得して前フレームとの平均ピクセル差を計算する
// 負荷を下げるためにcanvasを小さくリサイズしてから比較する（64x64程度）
function calcFrameDiff(prev: ImageData, curr: ImageData): number {
  let sum = 0;
  for (let i = 0; i < prev.data.length; i += 4) {
    sum += Math.abs(prev.data[i] - curr.data[i]);     // R
    sum += Math.abs(prev.data[i+1] - curr.data[i+1]); // G
    sum += Math.abs(prev.data[i+2] - curr.data[i+2]); // B
  }
  return sum / (prev.data.length / 4);
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
