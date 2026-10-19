import type { TitleBlockWord } from "./drawing-title-block";
import { makeSnapshotSource } from "./snapshot-source";

const dashes = /[\u2010-\u2015\u2212]/g;
export const normalizeEquipmentTag = (tag: string) =>
  tag
    .toUpperCase()
    .replace(dashes, "-")
    .replace(/\s+/g, "")
    .replace(/^([A-Z]+)(\d)/, "$1-$2");

// Unseparated names such as N101, m2, and Division 22 are not equipment.
// The automatic scan also learns custom names from the drawing's TAG/SYMBOL
// schedule columns; this vocabulary is a fallback, not a project-specific list.
const families = new Set(
  `AC ACC AD AH AHU AS ASHP AT AV B BF BFP BG BHP BLR BP BT CB CBV CH CHW CHWP CP CU DCW DCWBP DCWP DHW DHWP DHWRP DHWT DHWB DP DW DWH DWHT EF EHC EHR ERV ET EUH EWH EXF FA FC FCR FCU FD FFD FFH FP FPT FSD FT GD GH GT GTD HB HC HD HEX HFCU HP HRV HT HWB HWT HX JS KG KS L LAV MAU MD MH MS MUA P PD PRV RA RD RF RH RT RTU RW RWP S SF SH SK SL SP SS ST STP SV TD TMV UH UV V VAV VFD VRF WC WH WHT WS WT`.split(
    " ",
  ),
);
const prose = new Set(
  `ADD AISLE AND APPENDIX ASSET BUILDING BY CHAPTER CLASS COORD DAY DETAIL DIV DIVISION DRAWING DWG ELEC ELEV FLOOR FLOODED FOR FROM GRID IN ISSUED JANITOR KITCHEN LAUNDRY LEVEL LOBBY LOUNGE MAX MAXIMUM MIN MINIMUM MODEL NO NOTE OF ON OWNER PAGE PARKING PHASE PROGRESS REF REV REVISION ROOM SCALE SECTION SERVICE SHEET SI SIZE STORAGE THE TO TYPE VENDING VEST VOLUME`.split(
    " ",
  ),
);
const sheetPrefix = /^(?:A|C|E|F|G|I|ID|M|S|ST|STR|EL|ME|ARCH)$/;

type Mention = {
  tags: string[];
  ranges: Array<[number, number]>;
  prefix: string;
  explicit: boolean;
  start: number;
  end: number;
};
function mentions(text: string): Mention[] {
  const value = text.toUpperCase().replace(dashes, "-");
  const result: Mention[] = [];
  // Keep compound identifiers whole. In particular, never turn ADD-M01 into
  // M-01, HEX-20 into HEX-2, or FCU-1-2 into FCU-1.
  const pattern =
    /(?<![A-Z0-9./-])([A-Z]{1,8}(?:[./-][A-Z]{1,5})*)\s*(-?)\s*(\d{1,5}(?:[.-][A-Z0-9]{1,5})*[A-Z]{0,2})(?![A-Z0-9]|[-.][A-Z0-9])/g;
  for (const match of value.matchAll(pattern)) {
    const prefix = match[1]!;
    let body = match[3]!;
    let end = match.index + match[0].length;
    const baseEnd = end;
    const ranges: Array<[number, number]> = [[match.index, end]];
    const following = value.slice(end);
    const suffixList =
      /^(?:\s+([A-Z]{1,2}))?((?:\s*[/&,]\s*[A-Z]{1,2})+)(?![A-Z0-9]|[-.][A-Z0-9])/.exec(
        following,
      );
    let bodies = [body];
    if (suffixList) {
      const initialSuffix = suffixList[1] ?? /[A-Z]{1,2}$/.exec(body)?.[0];
      if (initialSuffix) {
        const stem = suffixList[1]
          ? body
          : body.slice(0, -initialSuffix.length);
        bodies = [
          initialSuffix,
          ...suffixList[2]!
            .split(/[/&,]/)
            .map((s) => s.trim())
            .filter(Boolean),
        ].map((suffix) => stem + suffix);
        const listStart = baseEnd + suffixList[0].indexOf(suffixList[2]!);
        if (suffixList[1]) ranges[0]![1] = listStart;
        for (const member of suffixList[2]!.matchAll(/[A-Z]{1,2}/g))
          ranges.push([
            listStart + member.index,
            listStart + member.index + member[0].length,
          ]);
        end += suffixList[0].length;
      }
    } else {
      const numbers =
        /^(?:\s*[/&,]\s*\d{1,5}[A-Z]{0,2})+(?![A-Z0-9]|[-.][A-Z0-9])/.exec(
          following,
        );
      if (numbers) {
        bodies = [
          body,
          ...numbers[0]
            .split(/[/&,]/)
            .map((s) => s.trim())
            .filter(Boolean),
        ];
        for (const member of numbers[0].matchAll(/\d{1,5}[A-Z]{0,2}/g))
          ranges.push([
            baseEnd + member.index,
            baseEnd + member.index + member[0].length,
          ]);
        end += numbers[0].length;
      }
    }
    // A standalone spaced letter is a suffix only when it is the end of this
    // text item or punctuation follows; do not absorb the first word of prose.
    if (end === match.index + match[0].length && !/[A-Z]$/.test(body)) {
      const suffix = /^\s+([A-Z])(?=$|[,;)])/.exec(following);
      if (suffix) {
        body += suffix[1];
        bodies = [body];
        end += suffix[0].length;
        ranges[0]![1] = end;
      }
    }
    const explicit = match[2] === "-" || /[-./]/.test(prefix);
    // A unit between two quantities must not become a tag, even for SF (fan).
    if (!explicit && /\d\s*$/.test(value.slice(0, match.index))) continue;
    result.push({
      tags: bodies.map((number) => `${prefix}-${number}`),
      ranges,
      prefix,
      explicit,
      start: match.index,
      end,
    });
  }
  return result;
}
export function tagPattern(tag: string) {
  const normalized = normalizeEquipmentTag(tag);
  if (!/^[A-Z][A-Z0-9./-]{1,39}$/.test(normalized) || !/\d/.test(normalized))
    return null;
  const escaped = normalized
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/-/g, "[-\\s]*");
  return new RegExp(
    `(?:^|[^A-Z0-9./-])${escaped}(?![A-Z0-9]|[-.][A-Z0-9])`,
    "i",
  );
}
export function containsEquipmentTag(text: string, tag: string) {
  if (!tagPattern(tag)) return false;
  const requested = new Set(mentions(tag).flatMap((m) => m.tags));
  if (!requested.size) requested.add(normalizeEquipmentTag(tag));
  return mentions(text).some((m) =>
    m.tags.some((value) => requested.has(value)),
  );
}

type Occurrence = Mention & { box: TitleBlockWord };
const cache = new WeakMap<TitleBlockWord[], Occurrence[]>();
const height = (w: TitleBlockWord) => w.bottom - w.top;
const charWidth = (w: TitleBlockWord) =>
  (w.right - w.left) / Math.max(1, w.text.length);
const center = (w: TitleBlockWord) => (w.left + w.right) / 2;
function sliceBox(
  word: TitleBlockWord,
  start: number,
  end: number,
): TitleBlockWord {
  // PDF text items can contain a whole note. Restrict the link to the matched
  // substring instead of making the entire sentence clickable.
  const width = word.right - word.left;
  return {
    ...word,
    text: word.text.slice(start, end),
    left: word.left + (width * start) / word.text.length,
    right: word.left + (width * end) / word.text.length,
  };
}
function occurrences(words: TitleBlockWord[]): Occurrence[] {
  const saved = cache.get(words);
  if (saved) return saved;
  const valid = words.filter(
    (w) =>
      [w.left, w.right, w.top, w.bottom].every(Number.isFinite) &&
      w.right > w.left &&
      w.bottom > w.top &&
      w.text.trim(),
  );
  const result: Occurrence[] = [];
  const add = (word: TitleBlockWord) => {
    for (const item of mentions(word.text))
      for (const [index, tag] of item.tags.entries()) {
        // Give grouped tags distinct hit areas; otherwise the last link would
        // cover every other member of labels such as AC-1 A/B/C.
        const [start, end] = item.ranges[index]!;
        result.push({ ...item, tags: [tag], box: sliceBox(word, start, end) });
      }
  };
  for (const word of valid) add(word);
  // Join only pieces of an identifier and only within a few character widths.
  // Never merge whole rows, nearby rooms, schedule columns, or sentences.
  const pieces = valid.filter((w) =>
    /^[A-Z0-9.\s/&,-]{1,24}$/i.test(w.text.trim()),
  );
  const byY = [...pieces].sort((a, b) => a.top - b.top || a.left - b.left);
  for (const first of pieces) {
    const prefix = /^([A-Z]{1,8}(?:[-./][A-Z]{1,5})*)\s*-?$/i.exec(
      first.text.trim(),
    );
    if (!prefix) continue;
    let last = first;
    const chain = [first];
    for (let n = 0; n < 4; n++) {
      const next = byY
        .filter(
          (w) =>
            !chain.includes(w) &&
            Math.abs(w.top - last.top) <=
              Math.min(height(w), height(last)) * 0.45 &&
            w.left >=
              last.right - Math.min(charWidth(w), charWidth(last)) * 0.3 &&
            w.left - last.right <=
              Math.max(charWidth(last), charWidth(w)) * 1.8 &&
            /^(?:-|\d{1,5}(?:[.-]\d{1,5})?[A-Z]{0,2}(?:\s*[/&,]\s*[A-Z0-9]{1,5})*)$/i.test(
              w.text.trim(),
            ),
        )
        .sort((a, b) => a.left - b.left)[0];
      if (!next) break;
      chain.push(next);
      last = next;
      if (/\d/.test(next.text)) {
        add({
          text: chain.map((w) => w.text).join(" "),
          left: first.left,
          right: next.right,
          top: Math.min(...chain.map((w) => w.top)),
          bottom: Math.max(...chain.map((w) => w.bottom)),
        });
        break;
      }
    }
    // Stacked tag bubbles use a prefix on one line and a number underneath.
    // Room labels are excluded by the same family/schedule classification.
    const below = byY
      .filter(
        (w) =>
          w !== first &&
          /^\d{1,5}[A-Z]{0,2}(?:[-.]\d{1,4})?$/.test(w.text.trim()) &&
          w.top >= first.bottom - height(first) * 0.15 &&
          w.top - first.bottom <= height(first) * 1.2 &&
          Math.abs(center(w) - center(first)) <=
            Math.max(first.right - first.left, w.right - w.left) * 0.3 &&
          height(w) / height(first) >= 0.6 &&
          height(w) / height(first) <= 1.7,
      )
      .sort((a, b) => a.top - b.top)[0];
    if (below)
      add({
        text: `${prefix[1]}-${below.text.trim()}`,
        left: Math.min(first.left, below.left),
        right: Math.max(first.right, below.right),
        top: first.top,
        bottom: below.bottom,
      });
  }
  // Same PDF text may be painted twice; retain the tightest copy of each tag.
  const unique: Occurrence[] = [];
  for (const item of result.sort(
    (a, b) =>
      (a.box.right - a.box.left) * (a.box.bottom - a.box.top) -
      (b.box.right - b.box.left) * (b.box.bottom - b.box.top),
  )) {
    const box = {
      ...item.box,
      left: Math.max(0, item.box.left),
      right: Math.min(1, item.box.right),
      top: Math.max(0, item.box.top),
      bottom: Math.min(1, item.box.bottom),
    };
    if (box.right <= box.left || box.bottom <= box.top) continue;
    for (const tag of item.tags) {
      if (
        unique.some(
          (other) =>
            other.tags[0] === tag &&
            Math.abs(center(other.box) - center(box)) <
              Math.max(charWidth(box), 0.00005) &&
            Math.abs(
              (other.box.top + other.box.bottom - box.top - box.bottom) / 2,
            ) <
              Math.min(height(box), height(other.box)) * 0.4,
        )
      )
        continue;
      unique.push({ ...item, tags: [tag], box });
    }
  }
  unique.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  cache.set(words, unique);
  return unique;
}
function plausible(item: Occurrence, automatic: boolean, known: Set<string>) {
  const tag = item.tags[0]!;
  if (known.has(tag)) return true;
  const baseFamily = item.prefix.split(/[-./]/)[0]!;
  const recognized =
    families.has(item.prefix) ||
    (item.explicit && baseFamily.length > 1 && families.has(baseFamily));
  if (item.prefix.split(/[-./]/).some((part) => prose.has(part))) return false;
  // References such as M-102 and room IDs S101 are not equipment. An explicitly
  // declared schedule tag can still use these prefixes.
  if (sheetPrefix.test(item.prefix) && /-\d{3,}/.test(tag)) return false;
  if (
    !item.explicit &&
    (!recognized || (automatic && item.prefix.length === 1))
  )
    return false;
  return recognized || (!automatic && item.explicit && item.prefix.length <= 8);
}
export function equipmentTagCandidates(
  words: TitleBlockWord[],
  points: Array<{ x: number; y: number }>,
  options: { automatic?: boolean; knownTags?: string[] } = {},
) {
  if (!points.length) return [];
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y)),
    bottom = Math.max(...points.map((p) => p.y));
  const known = new Set((options.knownTags ?? []).map(normalizeEquipmentTag));
  return [
    ...new Set(
      occurrences(words)
        .filter((item) => {
          const w = item.box;
          return (
            center(w) >= left &&
            center(w) <= right &&
            (w.top + w.bottom) / 2 >= top &&
            (w.top + w.bottom) / 2 <= bottom &&
            plausible(item, options.automatic ?? false, known)
          );
        })
        .flatMap((item) => item.tags),
    ),
  ];
}
export function equipmentTagLocations(words: TitleBlockWord[], tag: string) {
  const normalized = normalizeEquipmentTag(tag);
  return occurrences(words)
    .filter((item) => item.tags.includes(normalized))
    .map((item) => ({ ...item.box, text: normalized }));
}
/** Learn custom tags from schedule identifier columns, not manufacturer model columns. */
export function equipmentScheduleTags(
  pages: Array<{ words: TitleBlockWord[] }>,
) {
  const tags = new Set<string>();
  for (const { words } of pages) {
    if (!words.some((w) => /\bSCHEDULES?\b/i.test(w.text))) continue;
    const headers = words.filter((w) =>
      /^(?:SYMBOL|TAG|EQUIPMENT\s*(?:NO\.?|NUMBER))$/i.test(w.text.trim()),
    );
    for (const header of headers) {
      let previous = header.bottom;
      const column = words
        .filter(
          (word) =>
            word.top >= header.bottom &&
            Math.abs(center(word) - center(header)) <=
              Math.max(header.right - header.left, 0.006) * 0.8,
        )
        .sort((a, b) => a.top - b.top);
      for (const word of column) {
        const found = mentions(word.text);
        if (
          !found.length ||
          found[0]!.start !== 0 ||
          found.at(-1)!.end !== word.text.trimEnd().length
        )
          continue;
        // Stop at a gap between tables. A TAG header near the top of the page
        // must not authorize model numbers in a different table far below it.
        if (word.top - previous > 0.2) break;
        previous = word.bottom;
        for (const mention of found)
          if (!mention.prefix.split(/[-./]/).some((part) => prose.has(part)))
            for (const tag of mention.tags) tags.add(tag);
      }
    }
  }
  return [...tags];
}
export function equipmentDrawingDestination(input: {
  jobId: string;
  setId: string;
  sheetId: string;
  sourceSheetId: string;
  name: string;
  tag: string;
  box: TitleBlockWord;
}) {
  const { box } = input;
  return makeSnapshotSource(
    `/dashboard/jobs/${input.jobId}/drawings`,
    {
      version: 1,
      drawing: {
        jobId: input.jobId,
        setId: input.setId,
        sheetId: input.sheetId,
        sourceSheetId: input.sourceSheetId,
        viewport: {
          center: {
            x: (box.left + box.right) / 2,
            y: (box.top + box.bottom) / 2,
          },
          zoom: Math.min(
            10,
            Math.max(
              2,
              0.35 / Math.max(box.right - box.left, box.bottom - box.top),
            ),
          ),
        },
        appearance: { inverted: false, lineColor: null },
        layers: { markups: true, issues: true, private: true, published: true },
        selectedId: null,
        search: "",
        highlight: undefined,
      },
    },
    `${input.tag} — ${input.name}`,
  );
}
