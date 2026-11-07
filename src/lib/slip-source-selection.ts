import type { SlipBox } from "./packing-slip-review";

/** Normalized coordinates on the visible, rotated page. Never inferred text. */
export type SlipSourceWord = SlipBox & { page: number; text: string };

/** PDF.js text transform after the page viewport: support rotated pages too. */
export function slipPdfTextBox(
  transform: number[],
  width: number,
  pageWidth: number,
  pageHeight: number,
): SlipBox | undefined {
  if (
    transform.length < 6 ||
    !transform.every(Number.isFinite) ||
    pageWidth <= 0 ||
    pageHeight <= 0
  )
    return undefined;
  const advanceScale = Math.hypot(transform[0]!, transform[1]!);
  if (!advanceScale) return undefined;
  const dx = (transform[0]! * width) / advanceScale;
  const dy = (transform[1]! * width) / advanceScale;
  const x = transform[4]!,
    y = transform[5]!;
  const xs = [x, x + dx, x + transform[2]!, x + dx + transform[2]!];
  const ys = [y, y + dy, y + transform[3]!, y + dy + transform[3]!];
  return boundedSlipBox({
    x: Math.min(...xs) / pageWidth,
    y: Math.min(...ys) / pageHeight,
    width: (Math.max(...xs) - Math.min(...xs)) / pageWidth,
    height: (Math.max(...ys) - Math.min(...ys)) / pageHeight,
  });
}

export function boundedSlipBox(box: SlipBox): SlipBox | undefined {
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite))
    return undefined;
  const x = Math.max(0, Math.min(1, box.x));
  const y = Math.max(0, Math.min(1, box.y));
  const right = Math.max(x, Math.min(1, box.x + box.width));
  const bottom = Math.max(y, Math.min(1, box.y + box.height));
  if (right - x < 0.001 || bottom - y < 0.001) return undefined;
  return { x, y, width: right - x, height: bottom - y };
}

/** Group selected words into their physical rows, preserving column order.
 * Require the word's centre to be selected so neighbouring rows aren't copied. */
export function selectedSlipText(
  words: readonly SlipSourceWord[],
  page: number,
  selection: SlipBox,
): string {
  const box = boundedSlipBox(selection);
  if (!box) return "";
  const picked = words
    .filter((w) => {
      const rect = boundedSlipBox(w);
      if (w.page !== page || !rect || !w.text.trim()) return false;
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      return (
        x >= box.x &&
        x <= box.x + box.width &&
        y >= box.y &&
        y <= box.y + box.height
      );
    })
    .sort((a, b) => a.y + a.height / 2 - (b.y + b.height / 2));
  const rows: SlipSourceWord[][] = [];
  for (const word of picked) {
    const row = rows.at(-1);
    const first = row?.[0];
    if (
      first &&
      Math.abs(word.y + word.height / 2 - first.y - first.height / 2) <=
        Math.max(first.height, word.height) * 0.6
    )
      row.push(word);
    else rows.push([word]);
  }
  return rows
    .map((row) =>
      row
        .sort((a, b) => a.x - b.x)
        .map((w) => w.text.trim())
        .join(" "),
    )
    .join("\n")
    .slice(0, 2000);
}

/** Only our authenticated document route may supply slip evidence. */
export function slipSourceTextUrl(url: string): string | undefined {
  const match =
    /^(\/api\/job-documents\/files\/[0-9a-f-]{36})\?jobId=([0-9a-f-]{36})$/i.exec(
      url,
    );
  return match ? `${match[1]}/source-text?jobId=${match[2]}` : undefined;
}
