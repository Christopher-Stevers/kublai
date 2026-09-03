export type SheetTextItem = {
  str: string;
  x: number;
  y: number;
};

const SHEET_NUMBER =
  /\b([A-Z]{1,3}[-.]?\d{1,3}\.\d{1,3}[A-Z]?|[A-Z]{1,3}[-.]\d{2,4}[A-Z]?|[A-Z]{1,3}\d{2,4}[A-Z]?)\b/i;
const JUNK =
  /^(?:scale|date|drawn|checked|project|job|sheet|page|of|no\.?|dwg|rev(?:ision)?|north|as noted|n\.t\.s\.?|nts|of\s?\d+|page\s?\d+|sheet\s?\d+)$/i;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function inTitleBlock(item: SheetTextItem) {
  return item.x >= 0.58 && item.y >= 0.68;
}

function lineKey(y: number) {
  return Math.round(y * 80);
}

function scoreName(value: string) {
  const text = clean(value);
  if (!text || text.length < 2 || text.length > 80) return -1;
  if (JUNK.test(text)) return -1;
  if (SHEET_NUMBER.test(text) && !JUNK.test(text)) {
    const sheet = text.match(SHEET_NUMBER)?.[1] ?? text;
    return 100 + sheet.length;
  }
  if (/floor\s*plan|level|elevation|section|detail/i.test(text)) {
    return 40 + Math.min(text.length, 40);
  }
  if (/[A-Za-z]{4,}/.test(text) && text.length >= 8) {
    return 12 + Math.min(text.length, 30);
  }
  return -1;
}

export function extractSheetName(
  items: SheetTextItem[],
  fallback: string,
): string {
  const block = items
    .map((item) => ({
      str: clean(item.str),
      x: clamp01(item.x),
      y: clamp01(item.y),
    }))
    .filter((item) => item.str && inTitleBlock(item));

  const lines = new Map<number, SheetTextItem[]>();
  for (const item of block) {
    const key = lineKey(item.y);
    const list = lines.get(key) ?? [];
    list.push(item);
    lines.set(key, list);
  }

  const candidates: string[] = [];
  for (const list of lines.values()) {
    const joined = list
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join(" ");
    candidates.push(clean(joined));
    for (const item of list) candidates.push(item.str);
  }

  let best = fallback;
  let bestScore = 0;
  for (const candidate of candidates) {
    const sheet = candidate.match(SHEET_NUMBER)?.[1];
    const value = sheet ? clean(sheet.replace(/\s+/g, "")) : candidate;
    const score = scoreName(value === sheet ? value : candidate);
    const named = score >= 100 ? value : candidate;
    const namedScore = scoreName(named);
    if (namedScore > bestScore) {
      bestScore = namedScore;
      best = named;
    }
  }
  return best.slice(0, 80);
}
