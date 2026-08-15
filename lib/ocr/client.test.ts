import { detectText } from "./client";

// Vision REST の正常レスポンスを組み立てる
function okResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      responses: [{ textAnnotations: [{ description: text }] }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Vision REST は HTTP 200 のボディ内に画像ごとのエラーを返す
function visionErrorResponse(code: number, message: string): Response {
  return new Response(
    JSON.stringify({ responses: [{ error: { code, message } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function httpErrorResponse(status: number, statusText: string): Response {
  return new Response("{}", { status, statusText });
}

describe("detectText", () => {
  const originalApiKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

  beforeEach(() => {
    process.env.GOOGLE_CLOUD_VISION_API_KEY = "test-key";
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    // リトライログでテスト出力が汚れるのを防ぐ
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env.GOOGLE_CLOUD_VISION_API_KEY = originalApiKey;
  });

  it("APIキーが未設定の場合はエラーをスローする", async () => {
    delete process.env.GOOGLE_CLOUD_VISION_API_KEY;

    await expect(detectText("abc")).rejects.toThrow(
      "GOOGLE_CLOUD_VISION_API_KEY が設定されていません"
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("成功時は1回の呼び出しでテキストを返す", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("Lightning Bolt"));

    await expect(detectText("abc")).resolves.toBe("Lightning Bolt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("data: プレフィックス付きのbase64からプレフィックスを除去して送信する", async () => {
    fetchMock.mockResolvedValueOnce(okResponse("Counterspell"));

    await detectText("data:image/jpeg;base64,QUJD");

    const requestInit = fetchMock.mock.calls[0][1];
    if (!requestInit || typeof requestInit.body !== "string") {
      throw new Error("リクエストボディが文字列として送信されていません");
    }
    const body = JSON.parse(requestInit.body) as {
      requests: Array<{ image: { content: string } }>;
    };
    expect(body.requests[0].image.content).toBe("QUJD");
  });

  it("文字が検出できなかった画像では空文字を返す", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ responses: [{}] }), { status: 200 })
    );

    await expect(detectText("abc")).resolves.toBe("");
  });

  it("DEADLINE_EXCEEDED(4) を受けたら再試行し、成功すればテキストを返す", async () => {
    fetchMock
      .mockResolvedValueOnce(visionErrorResponse(4, "Backend deadline exceeded."))
      .mockResolvedValueOnce(okResponse("Black Lotus"));

    await expect(detectText("abc")).resolves.toBe("Black Lotus");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("UNAVAILABLE(14) も再試行対象とする", async () => {
    fetchMock
      .mockResolvedValueOnce(visionErrorResponse(14, "The service is currently unavailable."))
      .mockResolvedValueOnce(okResponse("Ancestral Recall"));

    await expect(detectText("abc")).resolves.toBe("Ancestral Recall");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("DEADLINE_EXCEEDED が続く場合は3回試行してから最後のエラーをスローする", async () => {
    // Response のボディは1度しか読めないため、試行ごとに新しいインスタンスを返す
    fetchMock.mockImplementation(async () =>
      visionErrorResponse(4, "Backend deadline exceeded.")
    );

    await expect(detectText("abc")).rejects.toThrow(
      "GCP Vision API エラー: 4 Backend deadline exceeded."
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("再試行しても回復しないVisionエラー(INVALID_ARGUMENT)は即座にスローする", async () => {
    fetchMock.mockImplementation(async () => visionErrorResponse(3, "Invalid image data."));

    await expect(detectText("abc")).rejects.toThrow(
      "GCP Vision API エラー: 3 Invalid image data."
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("HTTP 503 は再試行する", async () => {
    fetchMock
      .mockResolvedValueOnce(httpErrorResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(okResponse("Time Walk"));

    await expect(detectText("abc")).resolves.toBe("Time Walk");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("HTTP 403（キー不正）は再試行せず即座にスローする", async () => {
    fetchMock.mockImplementation(async () => httpErrorResponse(403, "Forbidden"));

    await expect(detectText("abc")).rejects.toThrow(
      "GCP Vision API HTTP error: 403 Forbidden"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("タイムアウト(AbortError)は再試行し、成功すればテキストを返す", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    fetchMock
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(okResponse("Mox Pearl"));

    await expect(detectText("abc")).resolves.toBe("Mox Pearl");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("タイムアウトが続く場合は AbortError をそのまま伝播させる（route が504に変換するため）", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    fetchMock.mockRejectedValue(abortError);

    await expect(detectText("abc")).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
