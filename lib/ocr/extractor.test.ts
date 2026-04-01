import { extractCardInfo } from "./extractor";

describe("extractCardInfo", () => {
  describe("正常系: カード名とセット情報の抽出", () => {
    it("カード名・セット略号・コレクター番号を正しく抽出できる", () => {
      const ocrText = `Lightning Bolt
Instant
Deal 3 damage to any target.
M11 · 149/249`;

      const result = extractCardInfo(ocrText);

      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("Lightning Bolt");
      expect(result!.setCode).toBe("M11");
      expect(result!.collectorNumber).toBe("149");
    });

    it("日本語カード名を抽出できる", () => {
      const ocrText = `稲妻
インスタント
クリーチャー1体かプレインズウォーカー1体かプレイヤー1人を対象とする。稲妻はそれに3点のダメージを与える。
M11 · 149/249`;

      const result = extractCardInfo(ocrText);

      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("稲妻");
    });

    it("セット略号がない場合はsetCodeがnullを返す", () => {
      const ocrText = `Counterspell
Instant
Counter target spell.`;

      const result = extractCardInfo(ocrText);

      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("Counterspell");
      expect(result!.setCode).toBeNull();
      expect(result!.collectorNumber).toBeNull();
    });

    it("ハイフン区切りのセット情報を抽出できる", () => {
      const ocrText = `Black Lotus
Artifact
NEO-123/456`;

      const result = extractCardInfo(ocrText);

      expect(result).not.toBeNull();
      expect(result!.setCode).toBe("NEO");
      expect(result!.collectorNumber).toBe("123");
    });
  });

  describe("異常系: 抽出不可のケース", () => {
    it("空文字の場合はnullを返す", () => {
      const result = extractCardInfo("");
      expect(result).toBeNull();
    });

    it("空白のみの場合はnullを返す", () => {
      const result = extractCardInfo("   \n  ");
      expect(result).toBeNull();
    });

    it("カード名が取れない場合はnullを返す", () => {
      // 数字だけのテキスト
      const ocrText = "123\n456\n789";
      const result = extractCardInfo(ocrText);
      expect(result).toBeNull();
    });
  });

  describe("境界値: 各種MTGカードパターン", () => {
    it("プレインズウォーカーカードのOCRテキストを処理できる", () => {
      const ocrText = `Jace, the Mind Sculptor
Planeswalker — Jace
+2: Look at the top card of target player's library.
WWK 31/145`;

      const result = extractCardInfo(ocrText);

      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("Jace, the Mind Sculptor");
    });

    it("コレクター番号のみ（分母なし）でも抽出できる", () => {
      const ocrText = `Force of Will
Instant
MH2 · 237`;

      const result = extractCardInfo(ocrText);

      expect(result).not.toBeNull();
      expect(result!.setCode).toBe("MH2");
      expect(result!.collectorNumber).toBe("237");
    });
  });
});
