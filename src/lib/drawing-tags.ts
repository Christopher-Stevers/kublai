import type { TitleBlockWord } from "./drawing-title-block";
import {
  equipmentTagIndex,
  equipmentTagCandidates,
  normalizeEquipmentTag,
} from "./equipment-tags";

/** Shared by source detection and destination lookup; equipment links keep their old keys. */
export const normalizeDrawingTag = (text: string) =>
  text
    .trim()
    .toUpperCase()
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, "")
    .split("/")
    .map(normalizeEquipmentTag)
    .join("/");
export function isDrawingTag(text: string) {
  const tag = normalizeDrawingTag(text);
  return (
    tag.length >= 1 &&
    tag.length <= 40 &&
    /^[A-Z0-9][A-Z0-9._/-]*$/.test(tag) &&
    !tag.includes("..") &&
    !/^\d+\/\d+$/.test(tag)
  );
}
const label =
  /\b(?:TAG|MARK|ROOM|RM|DOOR|WINDOW|GRID|KEYNOTE|NOTE|DETAIL|SECTION|SHEET|DWG|DRAWING|RISER|LINE|PIPE|CIRCUIT|PANEL|VALVE|DAMPER|DEVICE|FIXTURE|TYPE|SPEC(?:IFICATION)?)\s*[:#.-]?\s*$/i;
const nonTag =
  /\b(?:MODEL|PART|CATALOG(?:UE)?|FIGURE|ASTM|ASME|ANSI|NFPA|NEMA|CSA|ISO|SCALE|DATE|REVISION)\s*(?:NO\.?|NUMBER|#|:)?\s*$/i;
const unit =
  /^\s*(?:["'”″’%°]|MM\b|CM\b|FT\b|IN\b|INCH|GPM\b|CFM\b|PSI\b|KW\b|HP\b|RPM\b|HZ\b)/i;
const wordHeight = (word: TitleBlockWord) => word.bottom - word.top;
const valid = (word: TitleBlockWord) =>
  word.text.trim() &&
  [word.left, word.top, word.right, word.bottom].every(Number.isFinite) &&
  word.right > word.left &&
  word.bottom > word.top;
const cache = new WeakMap<
  TitleBlockWord[],
  { index: Map<string, TitleBlockWord[]>; automatic: Set<string> }
>();
function references(words: TitleBlockWord[]) {
  const saved = cache.get(words);
  if (saved) return saved;
  const index = equipmentTagIndex(words),
    automatic = new Set(
      equipmentTagCandidates(
        words,
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        { automatic: true },
      ),
    );
  const input = words.filter(valid);
  const rows = new Map<number, TitleBlockWord[]>();
  for (const word of input) {
    const row = Math.floor(word.top / 0.02);
    const items = rows.get(row) ?? [];
    items.push(word);
    rows.set(row, items);
  }
  const nearby = (word: TitleBlockWord) => {
    const items: TitleBlockWord[] = [];
    const reach = Math.min(0.12, Math.max(0.03, wordHeight(word) * 3));
    for (
      let row = Math.floor((word.top - reach) / 0.02);
      row <= Math.floor((word.bottom + reach) / 0.02);
      row++
    )
      items.push(...(rows.get(row) ?? []));
    return items;
  };
  const add = (text: string, box: TitleBlockWord, candidate: boolean) => {
    const tag = normalizeDrawingTag(text);
    if (!isDrawingTag(tag)) return;
    const found = index.get(tag) ?? [];
    if (
      !found.some(
        (item) =>
          Math.abs(item.left - box.left) < 0.0005 &&
          Math.abs(item.top - box.top) < 0.0005 &&
          Math.abs(item.right - box.right) < 0.0005 &&
          Math.abs(item.bottom - box.bottom) < 0.0005,
      )
    )
      index.set(tag, [...found, { ...box, text: tag }]);
    if (candidate) automatic.add(tag);
  };
  for (const word of input) {
    const text = word.text.replace(/[\u2010-\u2015\u2212]/g, "-");
    for (const match of text.matchAll(
      /(?<![A-Z0-9./_-])[A-Z0-9]+(?:[./_-][A-Z0-9]+)*(?![A-Z0-9./_-])/gi,
    )) {
      const token = match[0],
        start = match.index,
        end = start + token.length;
      if (!isDrawingTag(token)) continue;
      const before = text.slice(0, start),
        after = text.slice(end);
      const neighbor =
        nearby(word)
          .filter(
            (other) =>
              other !== word &&
              ((Math.abs(
                (other.top + other.bottom - word.top - word.bottom) / 2,
              ) <
                Math.min(wordHeight(other), wordHeight(word)) * 0.5 &&
                other.right <= word.left + 0.001 &&
                word.left - other.right < 0.025) ||
                (other.bottom <= word.top + 0.001 &&
                  word.top - other.bottom < wordHeight(word) * 2 &&
                  Math.abs(
                    (other.left + other.right - word.left - word.right) / 2,
                  ) <
                    Math.max(word.right - word.left, other.right - other.left) *
                      0.5)),
          )
          .sort(
            (a, b) =>
              Math.abs(a.right - word.left) +
              Math.abs(a.bottom - word.top) -
              Math.abs(b.right - word.left) -
              Math.abs(b.bottom - word.top),
          )[0]?.text ?? "";
      const context = before.trim() ? before : neighbor;
      if (nonTag.test(context) || unit.test(after)) continue;
      const upper = token === token.toUpperCase();
      const mixed = /[A-Z]/i.test(token) && /\d/.test(token);
      const explicit = label.test(context);
      const named = upper && /^[A-Z]{1,12}[-_][A-Z]{1,12}$/.test(token);
      // Isolated numeric/letter labels may be tags. They are offered for
      // explicit review, while dimensions and surrounding prose stay out.
      const short =
        /^(?:\d{1,6}[A-Z]?|[A-Z]{1,3})$/.test(token) && token === text.trim();
      const dimension =
        short &&
        nearby(word).some(
          (other) =>
            other !== word &&
            other.left >= word.right &&
            other.left - word.right < 0.015 &&
            Math.abs(other.top - word.top) < wordHeight(word) * 0.5 &&
            unit.test(other.text),
        );
      if (dimension || (!explicit && /^(?:MM|CM|FT|IN|KW|HP|HZ)$/.test(token)))
        continue;
      const section = explicit && /^\d{2}(?:[.-]\d{2}){2}$/.test(token);
      if (!(mixed && upper) && !named && !short && !explicit && !section)
        continue;
      if (/^\d+[.-]\d+$/.test(token) && !explicit) continue;
      const width = word.right - word.left;
      add(
        token,
        {
          ...word,
          text: token,
          left: word.left + (width * start) / text.length,
          right: word.left + (width * end) / text.length,
        },
        (mixed && upper) || named || explicit || short,
      );
      if (explicit && /^(?:\d{1,6}|[A-Z]{1,3})$/.test(token)) {
        const kind = /\b(DETAIL|SECTION)\s*[:#.-]?\s*$/i.exec(context)?.[1];
        if (kind)
          add(
            `${kind}-${token}`,
            {
              ...word,
              text: token,
              left: word.left + (width * start) / text.length,
              right: word.left + (width * end) / text.length,
            },
            false,
          );
      }
    }
  }
  // Detail bubbles often print the detail number above its sheet reference.
  for (const sheet of input.filter((word) =>
    /^[A-Z]{1,4}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?$/i.test(word.text.trim()),
  )) {
    const detail = nearby(sheet)
      .filter(
        (word) =>
          word !== sheet &&
          /^[A-Z0-9]{1,4}$/.test(word.text.trim()) &&
          word.bottom <= sheet.top + 0.001 &&
          sheet.top - word.bottom < wordHeight(sheet) * 2 &&
          Math.abs((word.left + word.right - sheet.left - sheet.right) / 2) <
            Math.max(sheet.right - sheet.left, word.right - word.left) * 0.45,
      )
      .sort((a, b) => b.bottom - a.bottom)[0];
    if (detail)
      add(
        `${detail.text}/${sheet.text}`,
        {
          text: `${detail.text}/${sheet.text}`,
          left: Math.min(detail.left, sheet.left),
          right: Math.max(detail.right, sheet.right),
          top: detail.top,
          bottom: sheet.bottom,
        },
        true,
      );
  }
  const result = { index, automatic };
  cache.set(words, result);
  return result;
}
export const drawingTagIndex = (words: TitleBlockWord[]) =>
  references(words).index;
export const drawingTagCandidates = (
  words: TitleBlockWord[],
  vocabulary: { knownTags?: string[]; sheetNumbers?: string[] } = {},
) => [
  ...new Set([
    ...references(words).automatic,
    ...equipmentTagCandidates(
      words,
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      { ...vocabulary, automatic: true },
    ),
  ]),
];
export const drawingTagLocations = (words: TitleBlockWord[], tag: string) =>
  references(words).index.get(normalizeDrawingTag(tag)) ?? [];
export function containsDrawingTag(text: string, tag: string) {
  if (!isDrawingTag(tag)) return false;
  const escaped = normalizeDrawingTag(tag)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/-/g, "[-\\s]*");
  return new RegExp(
    `(?:^|[^A-Z0-9._/-])${escaped}(?![A-Z0-9]|[-.][A-Z0-9])`,
    "i",
  ).test(text.replace(/\.(?:pdf|docx?|xlsx?|png|jpe?g)\b/gi, ""));
}
export function drawingTagsInArea(
  words: TitleBlockWord[],
  points: Array<{ x: number; y: number }>,
) {
  if (!points.length) return [];
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x));
  const top = Math.min(...points.map((p) => p.y)),
    bottom = Math.max(...points.map((p) => p.y));
  return [...drawingTagIndex(words)]
    .filter(([, boxes]) =>
      boxes.some(
        (box) =>
          (box.left + box.right) / 2 >= left &&
          (box.left + box.right) / 2 <= right &&
          (box.top + box.bottom) / 2 >= top &&
          (box.top + box.bottom) / 2 <= bottom,
      ),
    )
    .map(([tag]) => tag);
}
/** A detail/section callout includes its target sheet, rather than matching that
 * same reference wherever it is repeated in an index or note. */
export function drawingTagSheet(tag: string) {
  const normalized = normalizeDrawingTag(tag);
  const match =
    /^(?:([A-Z0-9]{1,6})\/)?([A-Z]{1,4}-?\d{1,4}(?:\.\d{1,3})?[A-Z]?)$/.exec(
      normalized,
    );
  return match
    ? { sheet: normalizeDrawingTag(match[2]!), detail: match[1] }
    : null;
}
