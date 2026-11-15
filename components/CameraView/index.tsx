"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { OcrResponse, PriceResponse, FetchStatus, PriceTagData, ShopId } from "@/types";
import { useCameraStream } from "./useCameraStream";
import GuideOverlay from "./GuideOverlay";

type CameraViewProps = {
  selectedShop: ShopId;
};

export default function CameraView({ selectedShop }: CameraViewProps) {
  const workerRef = useRef<Worker | null>(null);
  const { videoRef, cameraState, requestCamera } = useCameraStream(workerRef);

  // OCRリクエスト多重送信防止フラグ
  const isOcrPendingRef = useRef(false);
  // レート制限受信時のOCRスキップ管理
  const rateLimitedUntilRef = useRef<number | null>(null);

  // フロントキャッシュ: カード名 → 価格タグデータのMap
  const priceCache = useRef<Map<string, PriceTagData>>(new Map());

  const [fetchStatus, setFetchStatus] = useState<FetchStatus>("idle");
  const [priceTagData, setPriceTagData] = useState<PriceTagData | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // OCR→価格検索フローを実行する
  // imageBase64: キャプチャした画像のBase64文字列
  const handleFrame = useCallback(async (imageBase64: string) => {
    // レート制限中はOCRをスキップ（タップへの反応がないと故障と誤解されるため理由を表示する）
    if (rateLimitedUntilRef.current !== null && Date.now() < rateLimitedUntilRef.current) {
      setStatusMessage("リクエストが多すぎます。しばらくお待ちください");
      setFetchStatus("error");
      return;
    }

    isOcrPendingRef.current = true;
    setFetchStatus("searching");
    setStatusMessage("検索中...");

    let ocrResponse: OcrResponse;
    try {
      ocrResponse = await callOcrApi(imageBase64);
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

      // GCP障害（502/504）時はフロントで自動再送しない。
      // サーバ側（lib/ocr/client.ts）が既に再送しており、ここでさらに送ると
      // Vision API の課金ユニットが増幅するため、再試行はユーザーの再タップに委ねる
      if (error.code === "OCR_FAILED" || error.code === "OCR_TIMEOUT") {
        setStatusMessage("OCRサービスが一時的に利用できません。もう一度タップしてください");
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

    const { cardName, setCode, collectorNumber, collectorNumberFull } = ocrResponse;

    // フロントキャッシュにヒットすれば価格APIをスキップして即表示
    // ただし price: null のキャッシュはスキップして再取得する（価格未発見は再試行させる）
    // ショップをキーのプレフィックスに含めることでショップ切替後の混在を防ぐ
    const cacheKey = `${selectedShop}:${cardName}`;
    const cached = priceCache.current.get(cacheKey);
    if (cached && cached.priceResponse.price !== null) {
      setPriceTagData(cached);
      setFetchStatus("found");
      setStatusMessage(null);
      isOcrPendingRef.current = false;
      return;
    }

    // 価格検索APIを呼ぶ
    try {
      const priceResponse = await callPriceApi(cardName, setCode, collectorNumber, collectorNumberFull, selectedShop);

      // キャッシュが12時間以上前の場合は警告フラグを立てる（GuideOverlayで判定）
      const newPriceTagData: PriceTagData = { cardName, collectorNumberFull, priceResponse };
      priceCache.current.set(cacheKey, newPriceTagData);
      setPriceTagData(newPriceTagData);
      setFetchStatus(priceResponse.price !== null ? "found" : "not_found");
      setStatusMessage(null);
    } catch {
      setStatusMessage("価格情報の取得に失敗しました");
      setFetchStatus("error");
    }

    isOcrPendingRef.current = false;
  }, [selectedShop]);

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

  // ガイド枠タップ時にだけ OCR を実行する。
  // 静止検出による自動送信はカメラを置いたままにすると数秒ごとに Vision API を呼び続け、
  // 無料枠を大きく超える課金が発生したため廃止し、送信はユーザー操作に限定する
  const handleGuideAreaTap = useCallback(() => {
    // 応答待ちの間の連打で Vision API を多重に呼ばないようにする
    if (isOcrPendingRef.current) return;

    const canvas = drawingCanvasRef.current;
    if (!canvas) return;

    // カメラ映像がまだ canvas に描画されていない場合は空画像になるため送信しない
    const imageBase64 = canvas.toDataURL("image/jpeg", 0.8);
    if (imageBase64 === "data:,") {
      setStatusMessage("カメラの準備中です。少し待ってからタップしてください");
      setFetchStatus("error");
      return;
    }

    void handleFrame(imageBase64);
  }, [handleFrame]);

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
  collectorNumber: string | null,
  collectorNumberFull: string | null,
  shop: ShopId
): Promise<PriceResponse> {
  const params = new URLSearchParams({ card: cardName, shop });
  if (setCode) params.set("set", setCode);
  if (collectorNumber) params.set("num", collectorNumber);
  // hareruya2 のフォールバック検索で "分子/分母" 形式を使うために渡す
  if (collectorNumberFull) params.set("numFull", collectorNumberFull);

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
