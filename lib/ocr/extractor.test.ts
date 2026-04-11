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

  describe("ポケモンカードのOCRパターン", () => {
    // 実際の問題ログ: カミッチュカードのOCRテキスト
    // 構造: 1行目=進化段階（⑦進化）, 2行目=カード名（カミッチュ）, ...
    const KAMITCHU_OCR_TEXT = `⑦進化\nカミッチュ\nHP\nカジッチュから進化\nNO.1011 りんごあめポケモン 高さ: 0.4m 重さ: 4.4kg\n90@\nコーティングアタック\n20\n次の相手の番、このポケモンはたねポケモンからワザのダメージ\nを受けない。\n0x2\n抵抗力\nにげる\nillus. Souichirou Gunjima\nを出している そとッチュと尻尾を出している\nH SV7 011/102 C\nなかッチュが助け合い りんごのなかで暮らす。\n2024 Pokémon/Nintendo/Creatures/GAME FREAK.`;

    it("進化段階行（⑦進化）をスキップしてカード名（カミッチュ）を取得できる", () => {
      const result = extractCardInfo(KAMITCHU_OCR_TEXT);
      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("カミッチュ");
    });

    it("進化段階行（⑦進化）をカード名として返さない", () => {
      const result = extractCardInfo(KAMITCHU_OCR_TEXT);
      expect(result).not.toBeNull();
      expect(result!.cardName).not.toBe("⑦進化");
    });

    it("ポケモンカードのコレクター番号（199/193 AR）を抽出できる", () => {
      const ocrText = `たね\nコダック\n-70\n特性\nしめりけ\nこのポケモンがいるかぎり、おたがいのポケモン全員は、そのポケモン\n自身をきせつさせる効果の特性が、すべてなくなる。\n00\nぶつかる\n20\n7×21 民分\nいつも頭痛に悩まされている。 この頭痛が\n激しくなると不思議な力を使いはじめる。\nHun REND\n20\n199/193 AR\n●2025 Pokemon/Nintendo/Creatures/GAME FREAK`;
      const result = extractCardInfo(ocrText);
      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("コダック");
      expect(result!.collectorNumber).toBe("199");
    });
  });

  describe("日本語版MTGカードのレアリティ+コレクター番号パターン", () => {
    it("日本語版MTGカードの R+4桁コレクター番号（R 0328）を抽出できる", () => {
      const ocrText = `と\nでしょ\n行き届いた書庫\n801\n土地 平地・島\n行き届いた書庫はタップ状態で戦場に出る。\n行き届いた書庫が戦場に出たとき、諜報1 を行う。\nR 0328\nM&2024 Wizards of the Coast\nMKM JP SERGEY GLUSHAKOV`;
      const result = extractCardInfo(ocrText);
      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("行き届いた書庫");
      expect(result!.collectorNumber).toBe("328");  // 先頭ゼロ除去・3桁ゼロ埋め
      expect(result!.setCode).toBe("MKM");
    });
  });

  describe("マナコストOCR誤読行のスキップ", () => {
    // マナコストシンボル（例: {2}{G}{B}）がOCRで "2 gb." 等に誤読されるケースを除外する
    // 「さいしょく / 2 gb. / 彩色の宇宙儀」のようにマナコストがカード名より前に読まれる場合の回帰テスト
    const COSMIC_OCR_TEXT = `さいしょく
2 gb.
彩色の宇宙儀
7
伝説のアーティファクト
あなたはマナを望む色のマナであるかのように
支払ってもよい。
○○○○○○を加える。
あなたがコントロールしているパーマネ
ントの中の色1色につき1枚のカードを引く。
M0107
LCC JP GABOLEPS
TM & 2023 Wizards of the Coast`;

    it("マナコスト誤読行（2 gb.）をスキップして正しいカード名を抽出できる", () => {
      const result = extractCardInfo(COSMIC_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.cardName).toBe("彩色の宇宙儀");
    });

    it("マナコスト誤読行をカード名として返さない", () => {
      const result = extractCardInfo(COSMIC_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.cardName).not.toBe("2 gb.");
    });

    it("セット略号 LCC を抽出できる", () => {
      const result = extractCardInfo(COSMIC_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.setCode).toBe("LCC");
    });

    it("コレクター番号 107 を抽出できる", () => {
      const result = extractCardInfo(COSMIC_OCR_TEXT);

      expect(result).not.toBeNull();
      expect(result!.collectorNumber).toBe("107");
    });
  });
});
