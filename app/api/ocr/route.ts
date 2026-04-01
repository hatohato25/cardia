import { NextRequest, NextResponse } from "next/server";
import { detectText } from "@/lib/ocr/client";
import { extractCardInfo } from "@/lib/ocr/extractor";
import type { OcrResponse, ApiError, ErrorCode } from "@/types";

// レート制限の管理 (IPベース、60 req/min)
// Edge Runtimeではメモリが共有されないため、シンプルなin-memoryでの実装はNode.js Runtimeに限定
const RATE_LIMIT_PER_MINUTE = parseInt(
  process.env.RATE_LIMIT_PER_MINUTE ?? "60",
  10
);
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    // 新しいウィンドウを開始する
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= RATE_LIMIT_PER_MINUTE) {
    return false;
  }

  entry.count++;
  return true;
}

function getClientIp(req: NextRequest): string {
  // Vercelは X-Forwarded-For にクライアントIPを設定する
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : "unknown";
}

function errorResponse(
  message: string,
  code: ErrorCode,
  status: number
): NextResponse<ApiError> {
  return NextResponse.json<ApiError>({ error: message, code }, { status });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const clientIp = getClientIp(req);

  // レート制限チェック
  if (!checkRateLimit(clientIp)) {
    return errorResponse(
      "リクエストが多すぎます。しばらくお待ちください",
      "RATE_LIMITED",
      429
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse("リクエストボディの解析に失敗しました", "INVALID_REQUEST", 400);
  }

  // imageフィールドのバリデーション
  if (
    typeof body !== "object" ||
    body === null ||
    !("image" in body) ||
    typeof (body as Record<string, unknown>).image !== "string"
  ) {
    return errorResponse(
      "image フィールドが必要です",
      "INVALID_REQUEST",
      400
    );
  }

  const image = (body as { image: string }).image;

  // base64 形式の確認 (data:image/... プレフィックスあり・なし両方を受け付ける)
  const isValidBase64 =
    /^data:image\/[a-z]+;base64,/.test(image) ||
    /^[A-Za-z0-9+/]+=*$/.test(image);

  if (!isValidBase64) {
    return errorResponse(
      "image フィールドは有効なbase64形式である必要があります",
      "INVALID_REQUEST",
      400
    );
  }

  try {
    const ocrText = await detectText(image);
    // デバッグ: OCRテキストの内容を確認する（確認後に削除する）
    console.log("[/api/ocr] OCR text:", JSON.stringify(ocrText));
    const cardInfo = extractCardInfo(ocrText);

    const response: OcrResponse = {
      cardName: cardInfo?.cardName ?? null,
      setCode: cardInfo?.setCode ?? null,
      collectorNumber: cardInfo?.collectorNumber ?? null,
    };

    return NextResponse.json<OcrResponse>(response);
  } catch (error) {
    // タイムアウトエラーの判定（AbortController から来る）
    if (error instanceof Error && error.name === "AbortError") {
      console.error("[/api/ocr] GCP Vision API timeout", { clientIp });
      return errorResponse(
        "OCRサービスがタイムアウトしました",
        "OCR_TIMEOUT",
        504
      );
    }

    // GCP Vision API の HTTP エラー
    if (error instanceof Error && error.message.includes("GCP Vision API")) {
      console.error("[/api/ocr] GCP Vision API error", {
        message: error.message,
        clientIp,
      });
      return errorResponse(
        "OCRサービスが一時的に利用できません",
        "OCR_FAILED",
        502
      );
    }

    // その他の予期しないエラー
    console.error("[/api/ocr] Unexpected error", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return errorResponse("内部エラーが発生しました", "INTERNAL_ERROR", 500);
  }
}
