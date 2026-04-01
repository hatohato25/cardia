// GCP Vision API の TEXT_DETECTION を fetch ベースで呼び出すクライアント
// SDK は使わず fetch のみを使用してバンドルサイズを抑える

const GCP_VISION_API_URL =
  "https://vision.googleapis.com/v1/images:annotate";

// 3秒でタイムアウトする（FR-3-4 要件）
const OCR_TIMEOUT_MS = 3000;

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

// base64画像からOCRテキストを取得する
// タイムアウト時はAbortError をスロー
export async function detectText(imageBase64: string): Promise<string> {
  const apiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_CLOUD_VISION_API_KEY が設定されていません");
  }

  // data: プレフィックスが含まれている場合は除去する（GCP Vision API は純粋なbase64を要求）
  const pureBase64 = imageBase64.replace(/^data:image\/[a-z]+;base64,/, "");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

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
      throw new Error(`GCP Vision API HTTP error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as VisionApiResponse;
    const response = data.responses[0];

    if (!response) {
      throw new Error("GCP Vision API から空のレスポンスが返されました");
    }

    if (response.error) {
      throw new Error(
        `GCP Vision API エラー: ${response.error.code} ${response.error.message}`
      );
    }

    // textAnnotations[0] が全テキストの結合、以降が個別ブロック
    const fullText = response.textAnnotations?.[0]?.description;
    return fullText ?? "";
  } finally {
    clearTimeout(timeoutId);
  }
}
