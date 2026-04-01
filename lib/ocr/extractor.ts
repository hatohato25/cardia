import type { CardInfo } from "@/types";

// MTGカードのOCR抽出戦略:
// 1. カード名: テキストブロックの最初の行に来ることが多い
// 2. セット略号 + コレクター番号: 下部テキスト "SET · NNN/NNN" や "SET 123/456" パターン
// 3. 抽出失敗時は null を返し、caller 側でスキップ判定を行う

// セット略号: 2〜6文字の英数字（先頭は大文字）
// 例: "M11", "NEO", "MID", "KHM", "MH2", "MKM"
// コレクター番号: 数字/数字 または 数字のみ（例: "123/456", "42"）
const SET_COLLECTOR_PATTERN =
  /\b([A-Z][A-Z0-9]{1,5})\s*[·・\-\/\s]\s*(\d+)(?:\/\d+)?/;

// カード名として除外すべきノイズパターン（MTGのシステムテキストなど）
const CARD_NAME_EXCLUSION_PATTERNS = [
  /^(Legendary|Basic|Snow|World)/i,
  /^(Land|Creature|Instant|Sorcery|Enchantment|Artifact|Planeswalker|Battle)/i,
  /^\d+\/\d+$/,
  /^[A-Z]{2,5}\s*\d+/,
];

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

  const { setCode, collectorNumber } = extractSetAndCollectorNumber(ocrText);

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
    if (SET_COLLECTOR_PATTERN.test(line)) continue;

    // 除外パターンに一致する行はスキップ
    const isExcluded = CARD_NAME_EXCLUSION_PATTERNS.some((pattern) =>
      pattern.test(line)
    );
    if (isExcluded) continue;

    // 記号だけの行はカード名ではない
    if (/^[^a-zA-Z\u3040-\u30FF\u4E00-\u9FFF]+$/.test(line)) continue;

    return line;
  }

  return null;
}

// テキスト全体からセット略号とコレクター番号を抽出する
function extractSetAndCollectorNumber(ocrText: string): {
  setCode: string | null;
  collectorNumber: string | null;
} {
  const match = SET_COLLECTOR_PATTERN.exec(ocrText);
  if (!match) {
    return { setCode: null, collectorNumber: null };
  }

  const setCode = match[1] ?? null;
  const collectorNumber = match[2] ?? null;

  return { setCode, collectorNumber };
}
