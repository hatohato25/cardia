// カードの識別情報（OCRで抽出した構造化データ）
export type CardInfo = {
  cardName: string;
  setCode: string | null;
  // 分子のみ（例: "128"）。hareruya2 の通常検索クエリに使う
  collectorNumber: string | null;
  // "分子/分母" 形式（例: "128/101"）。hareruya2 のフォールバック検索に使う
  collectorNumberFull: string | null;
};

// /api/ocr のレスポンス型
export type OcrResponse = {
  cardName: string | null;
  setCode: string | null;
  // 分子のみ（例: "128"）
  collectorNumber: string | null;
  // "分子/分母" 形式（例: "128/101"）。hareruya2 フォールバック検索用
  collectorNumberFull: string | null;
};

// 対応ショップの識別子
export type ShopId = "hareruya" | "hareruya2";

// /api/price のレスポンス型
export type PriceResponse = {
  price: number | null;
  currency: "JPY";
  source: ShopId;
  cached: boolean;
  // ISO8601形式のキャッシュ保存日時（キャッシュ未ヒット時はnull）
  cachedAt: string | null;
};

// Redisにキャッシュする価格データ
export type CachedPrice = {
  price: number | null;
  currency: "JPY";
  source: ShopId;
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

// 価格タグに表示するデータ（カード名・コレクター番号・価格レスポンスのセット）
export type PriceTagData = {
  cardName: string;
  // "分子/分母" 形式（例: "128/101"）。同名カードの識別表示用
  collectorNumberFull: string | null;
  priceResponse: PriceResponse;
};
