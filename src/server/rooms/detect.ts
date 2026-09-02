export type RoomBBox = {
  type: "bbox";
  x: number;
  y: number;
  w: number;
  h: number;
};

export type DetectedRoom = {
  name: string;
  shape: RoomBBox;
};

const ROOM_LABEL =
  /\b(kitchen|bath(?:room)?|powder(?:\s*room)?|ensuite|bed(?:room)?|master(?:\s*bed(?:room)?)?|living(?:\s*room)?|family(?:\s*room)?|great\s*room|dining(?:\s*room)?|closet|wic|walk[- ]in(?:\s*closet)?|hall(?:way)?|foyer|entry|mudroom|laundry|utility|pantry|garage|office|den|loft|nook|storage|mechanical|electrical|furnace|boiler|workshop|basement|attic)\b/i;

type PdfTextItem = {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function detectRoomsFromPdfText(
  items: PdfTextItem[],
  pageWidth: number,
  pageHeight: number,
): DetectedRoom[] {
  if (pageWidth <= 0 || pageHeight <= 0) return [];

  const rooms: DetectedRoom[] = [];
  const used = new Set<number>();

  for (const [index, item] of items.entries()) {
    const text = item.str.replace(/\s+/g, " ").trim();
    if (!text || text.length > 40) continue;
    const match = text.match(ROOM_LABEL);
    if (!match) continue;
    if (used.has(index)) continue;
    used.add(index);

    const padX = Math.max(item.w * 2.5, pageWidth * 0.04);
    const padY = Math.max(item.h * 4, pageHeight * 0.035);
    const left = item.x - padX;
    const right = item.x + item.w + padX;
    const bottom = item.y - padY;
    const top = item.y + item.h + padY;

    rooms.push({
      name: titleCase(match[0] ?? text),
      shape: {
        type: "bbox",
        x: clamp01(left / pageWidth),
        y: clamp01(1 - top / pageHeight),
        w: clamp01((right - left) / pageWidth),
        h: clamp01((top - bottom) / pageHeight),
      },
    });
  }

  return rooms.slice(0, 40);
}
