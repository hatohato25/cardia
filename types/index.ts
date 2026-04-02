// カードの識別情報（OCRで抽出した構造化データ）
export type CardInfo = {
  cardName: string;
  setCode: string | null;
  collectorNumber: string | null;
};

// /api/ocr のレスポンス型
export type OcrResponse = {
  cardName: string | null;
  setCode: string | null;
  collectorNumber: string | null;
};

// /api/price のレスポンス型
export type PriceResponse = {
  price: number | null;
  currency: "JPY";
  source: "hareruya";
  cached: boolean;
  // ISO8601形式のキャッシュ保存日時（キャッシュ未ヒット時はnull）
  cachedAt: string | null;
};

// Redisにキャッシュする価格データ
export type CachedPrice = {
  price: number | null;
  currency: "JPY";
  source: "hareruya";
  cachedAt: string;
};

// APIエラーレスポンス型
export type ApiError = {
  error: string;
  code: ErrorCode;
};

// エラーコード定義
export type ErrorCode =
  | "INVALID_REQUEST"  // 400: リクエスト不正
  | "OCR_FAILED"       // 502: GCP Vision APIエラー
  | "OCR_TIMEOUT"      // 504: GCP Vision APIタイムアウト
  | "RATE_LIMITED"     // 429: レート制限超過
  | "INTERNAL_ERROR";  // 500: その他

// カメラの状態型
export type CameraState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "streaming" }
  | { status: "error"; reason: CameraError };

// カメラエラーの原因分類
export type CameraError =
  | "permission_denied"
  | "not_https"
  | "device_not_found"
  | "unknown";

// Worker へ送信するメッセージ型
export type WorkerInMessage =
  | { type: "START"; intervalMs: number }
  | { type: "STOP" };

// Worker から受信するメッセージ型
export type WorkerOutMessage =
  | { type: "FRAME"; imageBase64: string }
  | { type: "ERROR"; message: string };

// 価格取得の状態型
export type FetchStatus =
  | "idle"
  | "searching"
  | "found"
  | "not_found"
  | "error";

// 価格タグに表示するデータ（カード名と価格レスポンスのペア）
export type PriceTagData = {
  cardName: string;
  priceResponse: PriceResponse;
};
