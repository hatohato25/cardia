import { useEffect, useRef, useState, useCallback } from "react";
import type { CameraState, CameraError, WorkerInMessage } from "@/types";

type UseCameraStreamResult = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraState: CameraState;
  requestCamera: () => Promise<void>;
  stopCamera: () => void;
};

// MediaDevices エラーからカメラエラー種別に変換する
function classifyCameraError(error: unknown): CameraError {
  if (!window.isSecureContext) {
    return "not_https";
  }
  if (error instanceof DOMException) {
    if (
      error.name === "NotAllowedError" ||
      error.name === "PermissionDeniedError"
    ) {
      return "permission_denied";
    }
    if (
      error.name === "NotFoundError" ||
      error.name === "DevicesNotFoundError"
    ) {
      return "device_not_found";
    }
  }
  return "unknown";
}

export function useCameraStream(
  workerRef: React.RefObject<Worker | null>
): UseCameraStreamResult {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>({
    status: "idle",
  });

  // ストリームを停止してWorkerにも停止を通知する
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    // バックグラウンド移行時のGCP Vision APIコスト削減のためWorkerを停止
    const stopMsg: WorkerInMessage = { type: "STOP" };
    workerRef.current?.postMessage(stopMsg);
  }, [workerRef]);

  const requestCamera = useCallback(async () => {
    if (!window.isSecureContext) {
      setCameraState({ status: "error", reason: "not_https" });
      return;
    }

    setCameraState({ status: "requesting" });

    try {
      // iOS での facingMode: exact は失敗しやすいため ideal を使用する
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraState({ status: "streaming" });
    } catch (error) {
      const reason = classifyCameraError(error);
      setCameraState({ status: "error", reason });
    }
  }, []);

  // ページ非表示・離脱時にストリームを解放する（メモリリーク・バッテリー消費防止）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        stopCamera();
      }
    };

    const handlePageHide = () => {
      stopCamera();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [stopCamera]);

  // コンポーネントアンマウント時にストリームを解放する
  useEffect(() => {
    return () => {
      stopCamera();
    };
    // マウント時の登録のみで良いため依存配列は空にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { videoRef, cameraState, requestCamera, stopCamera };
}
