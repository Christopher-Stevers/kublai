export type TitleBlockWord = {
  text: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
};
export type SheetIdentity = {
  number: string;
  title: string;
  discipline: string;
};
type Line = TitleBlockWord & { height: number };
const clean = (s: string) =>
  s
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
const numberLabel =
  /^(?:(?:drawing|dwg|drg|sheet)\s*(?:number|no\.?|#|id)|sheet\s*(?::|$))\s*[:#]?\s*/i;
const titleLabel =
  /^(?:(?:drawing|dwg|drg|sheet)\s*title|title\s*(?::|$))\s*:?\s*/i;
const fieldLabel =
  /^(?:scale|date|drawn|checked|approved|designed|project|proj\.?|job|owner|client|revision|rev\.?|sheet created|issue|drawing|dwg|drg|sheet|title)\b\s*(?:[:.#]|title|number|no\b|created|name|$)/i;
const titleTerms =
  /\b(?:plans?|elevations?|sections?|details?|schedules?|legends?|drawing list|notes|schematics?|diagrams?|specifications?|layouts?|demolition)\b/i;
const border = (w: TitleBlockWord) =>
  w.left >= 0.65 || w.top >= 0.75 || w.right <= 0.15 || w.bottom <= 0.15;
function sheetNumber(text: string, labelled = false) {
  const value = clean(text)
    .replace(/\s*([.-])\s*/g, "$1")
    .replace(/^([A-Z]{1,4})\s+(?=\d)/i, "$1");
  if (
    /^[A-Z]{1,4}[-.]?\d{1,4}(?:[.-]\d{1,4})?[A-Z]?$/i.test(value) ||
    (labelled && /^\d{1,4}$/.test(value))
  )
    return value.toUpperCase();
  return "";
}
function linesFor(words: TitleBlockWord[]): Line[] {
  const lines: Line[] = [];
  for (const word of [...words].sort(
    (a, b) => a.bottom - b.bottom || a.left - b.left,
  )) {
    const height = Math.max(0.001, word.bottom - word.top);
    const line = lines.find(
      (l) =>
        Math.abs(l.bottom - word.bottom) <=
          Math.max(0.002, Math.min(height, l.height) * 0.4) &&
        word.left >= l.left - 0.001 &&
        word.left - l.right < 0.025,
    );
    if (line) {
      line.text = clean(`${line.text} ${word.text}`);
      line.right = Math.max(line.right, word.right);
      line.top = Math.min(line.top, word.top);
      line.height = Math.max(line.height, height);
    } else lines.push({ ...word, height });
  }
  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}
/** Use explicit title-block fields before any unlabeled border text. Never infer an identity from body references or filenames. */
export function extractDrawingIdentity(
  input: TitleBlockWord[],
  options: { allowInterior?: boolean } = {},
): SheetIdentity {
  const words = input
    .filter(
      (w) =>
        [w.left, w.top, w.right, w.bottom].every(Number.isFinite) &&
        w.right > w.left &&
        w.bottom > w.top &&
        w.text.trim() &&
        (options.allowInterior === true || border(w)),
    )
    .map((w) => ({ ...w, text: clean(w.text) }));
  const lines = linesFor(words);
  const eligible = (w: TitleBlockWord) =>
    options.allowInterior === true || border(w);
  const numberLabels = [...words, ...lines].filter(
    (w) => eligible(w) && numberLabel.test(w.text),
  );
  const numbered: Array<{
    number: string;
    line: TitleBlockWord;
    score: number;
  }> = [];
  for (const label of numberLabels) {
    const inline = sheetNumber(label.text.replace(numberLabel, ""), true);
    if (inline) numbered.push({ number: inline, line: label, score: 300 });
    for (const line of [...words, ...lines]) {
      const number = sheetNumber(line.text, true);
      if (!number) continue;
      const dy = line.top - label.bottom;
      const below = dy >= -0.005 && dy < 0.12 && line.left >= label.left - 0.04;
      const beside =
        Math.abs(line.bottom - label.bottom) < 0.012 &&
        line.left >= label.right - 0.002;
      if (below || beside)
        numbered.push({
          number,
          line,
          score:
            180 +
            (/[A-Z]/.test(number) ? 15 : 0) -
            Math.max(0, dy) * 500 -
            Math.abs(line.left - label.left) * 40,
        });
    }
  }
  // Large, isolated sheet codes at the edge are a fallback, never a number embedded in prose.
  if (!numbered.length)
    for (const line of lines) {
      const number = sheetNumber(line.text);
      if (
        number &&
        (options.allowInterior ||
          (line.top >= 0.78 && line.left >= 0.6) ||
          (line.left >= 0.85 && line.bottom <= 0.2))
      )
        numbered.push({
          number,
          line,
          score: 50 + line.height * 400 + line.left * 15 + line.bottom * 20,
        });
    }
  numbered.sort((a, b) => b.score - a.score);
  const chosen = numbered[0],
    number = chosen?.number ?? "";
  const anchors = [...words, ...lines].filter(
    (w) => eligible(w) && titleLabel.test(w.text),
  );
  const titles: Array<{ title: string; score: number }> = [];
  const isTitle = (text: string) =>
    !fieldLabel.test(text) &&
    !/\b(?:see|refer\s+to|reference|match\s*line)\b/i.test(text) &&
    !sheetNumber(text, true) &&
    !/^\W*$/.test(text) &&
    !(/^\d/.test(text) && !titleTerms.test(text)) &&
    text.length >= 3 &&
    text.length <= 255;
  for (const anchor of anchors) {
    const inline = clean(anchor.text.replace(titleLabel, ""));
    if (isTitle(inline)) titles.push({ title: inline, score: 300 });
    const candidates = lines
      .filter(
        (l) =>
          l.top >= anchor.bottom - 0.003 &&
          l.top - anchor.bottom < 0.12 &&
          l.left >= anchor.left - 0.015 &&
          l.left <= anchor.left + 0.04,
      )
      .sort((a, b) => a.top - b.top);
    const parts: string[] = [];
    let previous: Line | undefined;
    for (const line of candidates) {
      if (
        previous &&
        line.top - previous.bottom > Math.max(0.01, previous.height * 1.5)
      )
        break;
      if (!isTitle(line.text)) break;
      parts.push(line.text);
      previous = line;
      if (parts.length >= 5) break;
    }
    if (parts.length)
      titles.push({
        title: parts.join(" ").slice(0, 255),
        score:
          150 - (chosen ? Math.abs(anchor.left - chosen.line.left) * 30 : 0),
      });
  }
  if (!titles.length && chosen) {
    for (const line of lines) {
      if (
        eligible(line) &&
        isTitle(line.text) &&
        titleTerms.test(line.text) &&
        Math.abs(line.left - chosen.line.left) < 0.2 &&
        Math.abs(line.bottom - chosen.line.top) < 0.18
      )
        titles.push({
          title: line.text,
          score:
            50 -
            Math.abs(line.bottom - chosen.line.top) * 100 -
            Math.abs(line.left - chosen.line.left) * 50,
        });
    }
  }
  titles.sort((a, b) => b.score - a.score);
  const discipline =
    (
      {
        A: "Architectural",
        S: "Structural",
        M: "Mechanical",
        E: "Electrical",
        P: "Plumbing",
        C: "Civil",
        L: "Landscape",
        F: "Fire protection",
        G: "General",
      } as Record<string, string>
    )[number[0] ?? ""] ?? "";
  return { number, title: titles[0]?.title ?? "", discipline };
}

export function pdfTitleBlockWord(
  item: { str: string; transform: number[]; width: number; height: number },
  view: {
    width: number;
    height: number;
    convertToViewportPoint: (x: number, y: number) => number[];
  },
): TitleBlockWord {
  const [a = 1, b = 0, c = 0, d = 1, x = 0, y = 0] = item.transform;
  const length = Math.hypot(a, b) || 1,
    height = Math.hypot(c, d) || 1;
  const dx = (a / length) * item.width,
    dy = (b / length) * item.width,
    hx = (c / height) * item.height,
    hy = (d / height) * item.height;
  const points = [
    [x, y],
    [x + dx, y + dy],
    [x + hx, y + hy],
    [x + dx + hx, y + dy + hy],
  ].map((p) => view.convertToViewportPoint(p[0]!, p[1]!));
  return {
    text: item.str,
    left: Math.max(0, Math.min(1, ...points.map((p) => p[0]! / view.width))),
    right: Math.min(1, Math.max(0, ...points.map((p) => p[0]! / view.width))),
    top: Math.max(0, Math.min(1, ...points.map((p) => p[1]! / view.height))),
    bottom: Math.min(1, Math.max(0, ...points.map((p) => p[1]! / view.height))),
  };
}
