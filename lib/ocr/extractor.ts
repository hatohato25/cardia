import type { CardInfo } from "@/types";

// MTGカードのOCR抽出戦略:
// 1. カード名: テキストブロックの最初の行に来ることが多い
// 2. セット略号 + コレクター番号: 下部テキスト "SET · NNN/NNN" や "SET 123/456" パターン
//    または日本語版カード下部の "M0010" (Mプレフィックス+4桁) と "TLA JP ..." パターン
// 3. 抽出失敗時は null を返し、caller 側でスキップ判定を行う

// セット略号: 2〜6文字の英数字（先頭は大文字）
// 例: "M11", "NEO", "MID", "KHM", "MH2", "MKM"
// コレクター番号: 数字/数字 または 数字のみ（例: "123/456", "42"）
// 注意: \s は改行も含むため改行を挟んだ誤マッチを防ぐため [^\S\n] を使う
const SET_COLLECTOR_PATTERN_SYMBOL =
  /\b([A-Z][A-Z0-9]{1,5})[^\S\n]*[·・\-\/][^\S\n]*(\d+)(?:\/\d+)?/;

// スペース区切りのセット情報パターン: "WWK 31/145" 形式（行全体がセット情報）
// コレクター番号は2桁以上を要求することで "X2 1" のような1桁ノイズを除外する
// また "/" 区切りありの場合（"WWK 31/145"）も対応する
const SET_COLLECTOR_PATTERN_SPACE =
  /^([A-Z][A-Z0-9]{1,5})\s+(\d{2,})(?:\/\d+)?$/;

// 日本語版カード下部に現れるコレクター番号パターン: "M" + 4桁数字
// 例: "M0010" → コレクター番号 "010"（M除去・先頭ゼロ保持・不要ゼロは後で整形）
const M_PREFIXED_COLLECTOR_PATTERN = /\bM(\d{4})\b/;

// 日本語版MTGカード下部に現れるレアリティ+コレクター番号パターン（行全体）
// 例: "R 0328" → コレクター番号 "0328"（先頭ゼロ保持、整形は呼び出し側で行う）
// レアリティ記号: C(コモン)/U(アンコモン)/R(レア)/M(神話レア)/S(スペシャル)
const RARITY_COLLECTOR_PATTERN = /^[CURMS]\s+(\d{4})$/;

// ポケモンカードのコレクター番号パターン: 行中に現れる "NNN/NNN" または "NNN/NNN RARITY"（部分マッチ）
// 例: "199/193 AR" → コレクター番号 "199"
// 例: "0 20 205/193 AR" → コレクター番号 "205"（行頭のOCRノイズが混入した行にも対応）
// 行全体マッチ（^...$）ではなく部分マッチにすることで、OCRノイズが前後に付いた行でも抽出できる
// 先頭が数字なため SET_COLLECTOR_PATTERN_SPACE にマッチしない点を補完する
// MTGのパワー/タフネス（例: "3/4"）と区別するため、分母が20以上の行のみ対象とする
// ポケモンカードのコレクター番号分母は最低でも総収録数（通常50以上）が来るため安全
const POKEMON_COLLECTOR_PATTERN = /(\d+)\/(\d+)(?:\s+[A-Z]{1,3})?(?:\s|$)/;

// 日本語版カード下部に現れるセット略号パターン: 行頭の大文字英数字2〜5文字
// 例: "TLA JP MAEL OLLIVIER-HENRY" → "TLA"
// 例: "MH3 JP XAVIER RIBEIRO" → "MH3"（英数字混在のセット略号に対応）
const SET_CODE_LINE_PATTERN = /^([A-Z][A-Z0-9]{1,4})\s+[A-Z]{2}/;

// カード名として除外すべきノイズパターン（MTG英語版・汎用システムテキストなど）
const CARD_NAME_EXCLUSION_PATTERNS_EN = [
  /^(Legendary|Basic|Snow|World)/i,
  /^(Land|Creature|Instant|Sorcery|Enchantment|Artifact|Planeswalker|Battle)/i,
  /^\d+\/\d+$/,
  /^[A-Z]{2,5}\s*\d+/,
  // マナコストのOCR誤読行を除外する
  // 例: "{2}{G}{B}" → "2 gb." / "2gb" のように数字+色マナ略字(wubrgc)に変換されるパターン
  // カード名が数字+英小文字のみで構成されることはないため安全に除外できる
  /^\d+\s*[wubrgcWUBRGC\s.]+$/,
  // 丸数字（①〜⑨、U+2460〜U+2468）で始まる行はシステムテキストとして除外する
  // ポケモンカードの進化段階表記（例: "⑦進化"）等がカード名に誤検知されるのを防ぐ
  /^[①-⑨]/,
];

// 日本語版カードタイプ行として除外すべきパターン
// カード名より後に現れるカードタイプやキーワード能力行をスキップする
const CARD_TYPE_PATTERNS_JA = [
  /^(伝説の|基本|氷雪)/,
  /^(クリーチャー|インスタント|ソーサリー|エンチャント|アーティファクト|プレインズウォーカー|バトル|土地)/,
  // MTGカードタイプのサブタイプ区切りに使われる横棒（EM dash U+2014、全角ハイフン U+FF0D）のみを対象とする
  // 長音符「ー」（U+30FC）はカード名にも使われるため除外しない
  /[—－]/, // カードタイプのダッシュ区切りを含む行（例: "伝説のクリーチャー—バイソン"）
  // MTGキーワード能力行を除外する（カード名としてのスキップ対象）
  /^(瞬速|飛行|先制攻撃|二段攻撃|トランプル|到達|絆魂|速攻|警戒|呪禁|破壊不能|威迫|護法|接死|不滅|連繋|上陸|英雄的|果敢|感化|召集|続唱|奇跡|予顕|予示|変身|変容|合体|補強|再活|永続|脱出|適応|設計図|調査|製造|培養|発見|探偵|偽装|隠蔽|反逆|変異|生体|転生|城砦|殻)/,
  // ポケモンカードの進化段階・システム行を除外する
  // 丸数字（①〜⑨、U+2460〜U+2468）+「進化」のパターン（例: "⑦進化"）はカード名ではない
  /^[①-⑨]進化$/,
  // 「たねポケモン」「進化」「1進化」「2進化」等の進化段階行を除外する
  // 数字なしの「進化」単体（OCRで先頭に印刷される進化段階ヘッダ）もスキップ対象とするため \d* で0桁以上に対応する
  /^(たねポケモン|\d*進化|VSTAR|VMAX|GX|EX|V$)/,
  // 「〜から進化」行を除外する（例: "カジッチュから進化"）
  /から進化$/,
  // 「HP」単体行またはHP+数字行を除外する
  /^HP\d*$/,
];

// ひらがなのみで構成された行（ふりがな行）かどうかを判定する
// 日本語版カードでは1行目にふりがなが印刷されるため除外する必要がある
function isHiraganaOnlyLine(line: string): boolean {
  // ひらがな・長音符・スペース・句読点のみで構成されている場合はふりがな行とみなす
  return /^[\u3040-\u309F\u30FC\s、。]+$/.test(line);
}


export function extractCardInfo(ocrText: string): CardInfo | null {
  if (!ocrText.trim()) {
    return null;
  }

  const lines = ocrText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return null;
  }

  // カード名は最初の行に来ることが多いため先頭から探索する
  const cardName = extractCardName(lines);
  if (!cardName) {
    return null;
  }

  const { setCode, collectorNumber } = extractSetAndCollectorNumber(
    ocrText,
    lines
  );

  return {
    cardName,
    setCode,
    collectorNumber,
  };
}

// テキスト行のリストからカード名を抽出する
function extractCardName(lines: string[]): string | null {
  for (const line of lines) {
    // 短すぎる行（1文字以下）はカード名ではない
    if (line.length <= 1) continue;

    // 数字だけの行はカード名ではない
    if (/^\d+$/.test(line)) continue;

    // セット略号+コレクター番号のパターンはカード名ではない
    if (SET_COLLECTOR_PATTERN_SYMBOL.test(line)) continue;
    if (SET_COLLECTOR_PATTERN_SPACE.test(line)) continue;

    // 英語版の除外パターンに一致する行はスキップ
    const isExcludedEn = CARD_NAME_EXCLUSION_PATTERNS_EN.some((pattern) =>
      pattern.test(line)
    );
    if (isExcludedEn) continue;

    // 記号だけの行はカード名ではない
    if (/^[^a-zA-Z\u3040-\u30FF\u4E00-\u9FFF]+$/.test(line)) continue;

    // ふりがな行（ひらがなのみ）はカード名ではないためスキップする
    // 日本語版カードの1行目はふりがなが印刷されている
    if (isHiraganaOnlyLine(line)) continue;

    // 日本語版のカードタイプ行はカード名ではないためスキップする
    const isCardTypeLine = CARD_TYPE_PATTERNS_JA.some((pattern) =>
      pattern.test(line)
    );
    if (isCardTypeLine) continue;

    // OCRノイズで先頭に1桁の数字が日本語文字に付着した場合（例: "1ロケット団のニャーズ"）を除去する
    // 進化段階の数字がカード名行に混入するケースで発生するため、日本語文字の前の1桁数字を削除する
    const leadingDigitMatch = /^(\d)([\u3040-\u30FF\u4E00-\u9FFF])/.exec(line);
    const cleanedLine = leadingDigitMatch ? line.slice(1) : line;

    // OCRノイズで末尾に " x 210円"、" × 150ダメージ"、" 210円" のようなダメージ行が混入した場合を除去する
    // カード名行に別行のダメージ量テキストが結合されるケースで発生するため、" (x/×) 数字" 以降を削除する
    // "x/×" はオプション（?）にすることで、乗算記号なしで直接 " 210円" と付くケース（ワザダメージ）も除去できる
    // カード名に "円" や "点" が含まれるMTG/ポケモンカードは存在しないため、これらを含む末尾サフィックスは安全に除去できる
    const trailingNoiseMatch = /\s+(?:[x×]\s*)?\d+[円点ダ].*$/.exec(cleanedLine);
    if (trailingNoiseMatch) {
      const trimmed = cleanedLine.slice(0, trailingNoiseMatch.index).trim();
      // ゴミ除去後にカード名として意味のある文字列が残る場合のみ返す
      if (trimmed.length > 1) {
        return trimmed;
      }
    }

    return cleanedLine;
  }

  return null;
}

// テキスト全体からセット略号とコレクター番号を抽出する
// 日本語版カードの "M0010" / "TLA JP ..." パターンにも対応する
function extractSetAndCollectorNumber(
  ocrText: string,
  lines: string[]
): {
  setCode: string | null;
  collectorNumber: string | null;
} {
  // まず記号区切りパターン（"SET · NNN"）を試みる
  const symbolMatch = SET_COLLECTOR_PATTERN_SYMBOL.exec(ocrText);
  if (symbolMatch) {
    return {
      setCode: symbolMatch[1] ?? null,
      collectorNumber: symbolMatch[2] ?? null,
    };
  }

  // 次にスペース区切りパターン（"WWK 31/145"）を行単位で試みる
  // 行全体がセット情報であることを確認するため各行に対して適用する
  // "HP 260" のようなポケモンカードのHP行が誤マッチしないよう "HP" を除外する
  // MTGに存在しない略号かつポケモン特有の表記（HP/EX/GX等）を非セット略号リストで除外する
  const NON_SET_CODES = new Set(["HP", "EX", "GX", "AR", "SR", "SAR", "RR", "RRR", "PR", "CSR", "CHR", "UR", "ACE"]);
  for (const line of lines) {
    const spaceMatch = SET_COLLECTOR_PATTERN_SPACE.exec(line);
    if (spaceMatch) {
      const matchedCode = spaceMatch[1] ?? null;
      // ポケモンカード特有の非セット略号はスキップする（HP行等の誤検知防止）
      if (matchedCode !== null && NON_SET_CODES.has(matchedCode)) continue;
      return {
        setCode: matchedCode,
        collectorNumber: spaceMatch[2] ?? null,
      };
    }
  }

  // ポケモンカードのコレクター番号パターンを行単位で試みる: "199/193 AR" → "199"
  // MTGパターンより前に評価することで、純粋な数字/数字行を正しく処理する
  // 分母が20以上の場合のみコレクター番号とみなし、MTGのパワー/タフネス（例: "3/4"）を除外する
  for (const line of lines) {
    const pokemonMatch = POKEMON_COLLECTOR_PATTERN.exec(line);
    if (pokemonMatch) {
      const denominator = parseInt(pokemonMatch[2] ?? "0", 10);
      if (denominator >= 20) {
        return {
          setCode: null,
          collectorNumber: pokemonMatch[1] ?? null,
        };
      }
    }
  }

  // 日本語版カードのパターンを試みる

  // レアリティ+コレクター番号パターン（行単位）を M プレフィックスパターンより優先して試みる
  // "R 0328" のように行全体がレアリティ記号+4桁数字で構成される行を検索する
  // 先頭ゼロ除去 → 3桁ゼロ埋め（Hareruya の "(NNN)" 形式に合わせる）
  let rarityCollectorNumber: string | null = null;
  for (const line of lines) {
    const rarityMatch = RARITY_COLLECTOR_PATTERN.exec(line);
    if (rarityMatch?.[1]) {
      rarityCollectorNumber = String(parseInt(rarityMatch[1], 10)).padStart(3, "0");
      break;
    }
  }

  // M プレフィックスパターン（例: "M0010"）でコレクター番号を取得する
  const collectorMatch = M_PREFIXED_COLLECTOR_PATTERN.exec(ocrText);
  const rawCollectorDigits = collectorMatch?.[1] ?? null;
  // 4桁数字（例: "0010"）から数値として読み取り3桁ゼロ埋めにする
  const mPrefixedCollectorNumber =
    rawCollectorDigits !== null
      ? String(parseInt(rawCollectorDigits, 10)).padStart(3, "0")
      : null;

  // レアリティパターンを優先し、なければ M プレフィックスパターンを使う
  const collectorNumber = rarityCollectorNumber ?? mPrefixedCollectorNumber;

  // セット略号: "TLA JP ..." のように行頭に2〜4大文字英字が来る行から抽出する
  let setCode: string | null = null;
  for (const line of lines) {
    const setMatch = SET_CODE_LINE_PATTERN.exec(line);
    if (setMatch) {
      setCode = setMatch[1] ?? null;
      break;
    }
  }

  // どちらか一方でも抽出できた場合は返す
  if (collectorNumber !== null || setCode !== null) {
    return { setCode, collectorNumber };
  }

  return { setCode: null, collectorNumber: null };
}
