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
const SET_COLLECTOR_PATTERN_SPACE =
  /^([A-Z][A-Z0-9]{1,5})\s+(\d+)(?:\/\d+)?$/;

// 日本語版カード下部に現れるコレクター番号パターン: "M" + 4桁数字
// 例: "M0010" → コレクター番号 "010"（M除去・先頭ゼロ保持・不要ゼロは後で整形）
const M_PREFIXED_COLLECTOR_PATTERN = /\bM(\d{4})\b/;

// 日本語版カード下部に現れるセット略号パターン: 行頭の2〜4大文字英字
// 例: "TLA JP MAEL OLLIVIER-HENRY" → "TLA"
const SET_CODE_LINE_PATTERN = /^([A-Z]{2,4})\s+[A-Z]{2}/;

// カード名として除外すべきノイズパターン（英語版MTGのシステムテキストなど）
const CARD_NAME_EXCLUSION_PATTERNS_EN = [
  /^(Legendary|Basic|Snow|World)/i,
  /^(Land|Creature|Instant|Sorcery|Enchantment|Artifact|Planeswalker|Battle)/i,
  /^\d+\/\d+$/,
  /^[A-Z]{2,5}\s*\d+/,
];

// 日本語版カードタイプ行として除外すべきパターン
// カード名より後に現れるカードタイプやキーワード能力行をスキップする
const CARD_TYPE_PATTERNS_JA = [
  /^(伝説の|基本|氷雪)/,
  /^(クリーチャー|インスタント|ソーサリー|エンチャント|アーティファクト|プレインズウォーカー|バトル|土地)/,
  /[ーー]/, // カードタイプのダッシュ区切りを含む行（例: "伝説のクリーチャー-バイソン・同盟者"）
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

    return line;
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
  for (const line of lines) {
    const spaceMatch = SET_COLLECTOR_PATTERN_SPACE.exec(line);
    if (spaceMatch) {
      return {
        setCode: spaceMatch[1] ?? null,
        collectorNumber: spaceMatch[2] ?? null,
      };
    }
  }

  // 日本語版カードのパターンを試みる
  // コレクター番号: "M0010" → "010"（Mプレフィックス除去、数値の先頭ゼロ保持して3桁に整形）
  const collectorMatch = M_PREFIXED_COLLECTOR_PATTERN.exec(ocrText);
  const rawCollectorDigits = collectorMatch?.[1] ?? null;
  // 4桁数字（例: "0010"）から数値として読み取り3桁ゼロ埋めにする
  const collectorNumber =
    rawCollectorDigits !== null
      ? String(parseInt(rawCollectorDigits, 10)).padStart(3, "0")
      : null;

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
