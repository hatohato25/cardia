// GCP Vision API の TEXT_DETECTION を fetch ベースで呼び出すクライアント
// SDK は使わず fetch のみを使用してバンドルサイズを抑える

const GCP_VISION_API_URL =
  "https://vision.googleapis.com/v1/images:annotate";

// 1 回の呼び出しあたり 3 秒でタイムアウトする（FR-3-4 要件）
const OCR_ATTEMPT_TIMEOUT_MS = 3000;

// Vision バックエンドの一時的な輻輳（DEADLINE_EXCEEDED / UNAVAILABLE）は
// 短いタイムアウトで打ち切って再送するほうが、1 回を長く待つより成功率が高い。
// 最悪ケースでも 3s * 3 + バックオフ ≒ 10 秒で確定させる。
const OCR_MAX_ATTEMPTS = 3;
const OCR_RETRY_BASE_DELAY_MS = 250;

// gRPC canonical code。Vision REST は HTTP 200 のボディ内に
// 画像ごとのエラーとしてこのコードを返してくる（例: 4 Backend deadline exceeded）
const GRPC_CODE_DEADLINE_EXCEEDED = 4;
const GRPC_CODE_UNAVAILABLE = 14;

// Google 側の一時的障害・スロットリングを示す HTTP ステータス
// 401/403（キー不正）や 400（リクエスト不正）は再送しても回復しないため含めない
const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);

export type VisionTextAnnotation = {
  description: string;
  locale?: string;
};

type VisionApiResponse = {
  responses: Array<{
    textAnnotations?: VisionTextAnnotation[];
    error?: {
      code: number;
      message: string;
    };
  }>;
};

// 1 回の試行結果。再試行しても無駄なエラーは attempt 関数から直接スローし、
// 再試行する価値があるものだけを retryable として呼び出し側に返す
type AttemptResult =
  | { kind: "success"; text: string }
  | { kind: "retryable"; error: Error };

// base64画像からOCRテキストを取得する
// 一時的な失敗は内部で再試行し、最終的に失敗した場合は最後のエラーをそのままスローする
// （route 側が AbortError / Vision エラーを判別してステータスコードを決めるため加工しない）
export async function detectText(imageBase64: string): Promise<string> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_CLOUD_VISION_API_KEY が設定されていません");
  }

  // data: プレフィックスが含まれている場合は除去する（GCP Vision API は純粋なbase64を要求）
  const pureBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

  for (let attempt = 1; attempt <= OCR_MAX_ATTEMPTS; attempt++) {
    const result = await requestTextDetection(apiKey, pureBase64);

    if (result.kind === "success") {
      return result.text;
    }

    if (attempt === OCR_MAX_ATTEMPTS) {
      throw result.error;
    }

    console.warn("[ocr] Vision API retryable failure", {
      attempt,
      message: result.error.message,
    });
    await sleep(backoffDelayMs(attempt));
  }

  // ループは必ず return / throw で抜けるため到達しないが、TS の網羅性のために残す
  throw new Error("OCRの再試行処理が予期せず終了しました");
}

// Vision API を 1 回呼び出す
async function requestTextDetection(
  apiKey: string,
  pureBase64: string
): Promise<AttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OCR_ATTEMPT_TIMEOUT_MS);

  try {
    const res = await fetch(`${GCP_VISION_API_URL}?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: pureBase64 },
            features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const httpError = new Error(
        `GCP Vision API HTTP error: ${res.status} ${res.statusText}`
      );
      if (RETRYABLE_HTTP_STATUSES.has(res.status)) {
        return { kind: "retryable", error: httpError };
      }
      throw httpError;
    }

    const data = (await res.json()) as VisionApiResponse;
    const response = data.responses[0];

    if (!response) {
      throw new Error("GCP Vision API から空のレスポンスが返されました");
    }

    if (response.error) {
      const apiError = new Error(
        `GCP Vision API エラー: ${response.error.code} ${response.error.message}`
      );
      if (
        response.error.code === GRPC_CODE_DEADLINE_EXCEEDED ||
        response.error.code === GRPC_CODE_UNAVAILABLE
      ) {
        return { kind: "retryable", error: apiError };
      }
      throw apiError;
    }

    // textAnnotations[0] が全テキストの結合、以降が個別ブロック
    // Vision は文字を検出できなかった画像では textAnnotations 自体を返さないため、
    // 未検出は空文字として正常系で扱う（カード非認識は caller 側が判定する）
    const fullText = response.textAnnotations?.[0]?.description;
    return { kind: "success", text: fullText ?? "" };
  } catch (error) {
    // タイムアウトによる中断は Vision 側の遅延を示すため再試行対象とする
    if (error instanceof Error && error.name === "AbortError") {
      return { kind: "retryable", error };
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 同時に失敗した複数リクエストが同一タイミングで再送して輻輳を悪化させないよう
// 指数バックオフにジッターを加える
function backoffDelayMs(attempt: number): number {
  const base = OCR_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * OCR_RETRY_BASE_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
