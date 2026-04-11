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

  describe("日本語版カードのOCRパターン", () => {
    // 実際のOCRで取得できるテキストを使ったテスト
    // 構造: 1行目=ふりがな, 2行目=カード名, 3行目=マナコスト, 4行目=カードタイプ, ...
    // 下部: "M0010" 形式のコレクター番号, "TLA JP ..." 形式のセット情報
    const ACTUAL_OCR_TEXT = `ふどう しゅごしゃ
不動の守護者、アッパ
②
伝説のクリーチャー-バイソン・同盟者
瞬速
飛行
これが戦場に出たとき、 あなたがコントロールしていて土
地でもこれでもない望む数のパーマネントを対象とする。
それらに気の技を行う。 それらを追放する。 追放されている問
それらのオーナーはそれらのマナ・コストではなく2で唱えてもよ
い。)
あなたが追放領域から呪文1つを唱えるたび、 白の1/1の
同盟者・クリーチャー・トークン1体を生成する。
M0010
TLA JP MAEL OLLIVIER-HENRY
3/4
02025 Viacom.
I&2025 Wizards of the Coast`;

    it("ふりがな行をスキップして漢字カード名を抽出できる", () => {
      const result = extractCardInfo(ACTUAL_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("不動の守護者、アッパ");
    });

    it("M0010 から collectorNumber を 3桁ゼロ埋めで抽出できる", () => {
      const result = extractCardInfo(ACTUAL_OCR_TEXT);

      expect(result).not.toBeNull();
      // "M0010" → 数値10 → 3桁ゼロ埋め "010"
      expect(result!.collectorNumber).toBe("010");
    });

    it("TLA JP ... から setCode TLA を抽出できる", () => {
      const result = extractCardInfo(ACTUAL_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.setCode).toBe("TLA");
    });

    it("カードタイプ行（伝説のクリーチャー）をカード名として抽出しない", () => {
      const result = extractCardInfo(ACTUAL_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.cardName).not.toMatch(/^伝説の/);
    });

    it("キーワード能力行（瞬速・飛行）をカード名として抽出しない", () => {
      const result = extractCardInfo(ACTUAL_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.cardName).not.toBe("瞬速");
      expect(result!.cardName).not.toBe("飛行");
    });
  });

  describe("長音符を含むカード名のOCRパターン", () => {
    // 「攪乱のフルート」のように長音符「ー」を含むカード名が正しく抽出されることを確認する
    // 以前「ー」をカードタイプのダッシュと誤判定してスキップしていたバグの回帰テスト
    const FLUTE_OCR_TEXT = `かくらん
攪乱のフルート
2
アーティファクト
瞬速
乱のフルートが戦場に出るに際し、カード名1つ
を選ぶ。
その選ばれたカード名を持つ呪文を唱えるためのコ
ストは多くなる。
その選ばれたカード名を持つ発生源の起動型能力
は、それがマナ能力でないかぎり起動できない。
R 0209
MH3 JP XAVIER RIBEIRO
TM & © 2024 Wizards of the Coast`;

    it("長音符を含むカード名（攪乱のフルート）を正しく抽出できる", () => {
      const result = extractCardInfo(FLUTE_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("攪乱のフルート");
    });

    it("キーワード能力行（瞬速）をカード名として抽出しない", () => {
      const result = extractCardInfo(FLUTE_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.cardName).not.toBe("瞬速");
    });

    it("セット略号 MH3 を抽出できる", () => {
      const result = extractCardInfo(FLUTE_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.setCode).toBe("MH3");
    });
  });
});
