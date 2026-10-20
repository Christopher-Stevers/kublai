import { extractDrawingIdentity, type TitleBlockWord } from "./drawing-title-block";
import { makeSnapshotSource } from "./snapshot-source";

const dashes = /[\u2010-\u2015\u2212]/g;
export const normalizeEquipmentTag = (tag: string) =>
  tag
    .toUpperCase()
    .replace(dashes, "-")
    .replace(/\s+/g, "")
    .replace(/^([A-Z]+)(\d)/, "$1-$2");

// Unseparated names such as N101, m2, and Division 22 are not equipment.
// The automatic scan also learns custom names from the drawing's schedules;
// this vocabulary is a fallback, not a project-specific list. It was checked
// against the abbreviation legends of public MEP bid sets (see
// docs/references/equipment-tags).
const families = new Set(
  `AC ACC ACCH ACCU ACU AD AF AH AHU AS ASHP ATS AV B BB BF BFP BG BHP BLR BP BT CAV CB CBV CD CF CH CHLR CHP CHW CHWP CP CR CRAC CRAH CRP CT CTP CTWP CU CUH CV CWP DCP DCW DCWBP DCWP DD DEF DF DH DHW DHWB DHWP DHWRP DHWT DOAS DP DS DW DWH DWHT EAF ECH EDH EF EG EH EHC EHR EP ERU ERV ESH ET EUH EW EWC EWH EXF FA FACP FC FCO FCR FCU FD FDC FE FEC FFD FFH FHC FP FPB FPT FPTU FPVAV FS FSD FT FTR GD GEF GEN GH GI GT GTD GUH GWH HB HC HD HEX HFCU HP HRU HRV HT HTR HUM HV HWB HWC HWCP HWP HWRP HWT HWUH HX IU IWH JP KEF L LAV LD LP MAU MB MCC MD MDP MH MS MSB MUA OAU OD OI P PB PD PIV PNL PP PRV PTAC RD RF RG RH RHC RP RPZ RT RTU RW RWP S SB SD SE SF SG SH SK SL SP SS ST STP SUH SV SWBD T TD TEF TF TG TMV TU TX UH UPS UR UV V VAV VFD VRF WC WCO WCU WH WHA WHT WM WS WSHP WT XFMR`.split(
    " ",
  ),
);
// Standards bodies cite their documents like tags: "ASTM B-62", "NEMA KS 1".
const standards = `ANSI ASTM ASME AWWA MSS NEMA UL ULC NFPA ASSE CSA ISO IEEE IEC SMACNA ASHRAE AHRI ARI CISPI NSF IAPMO PDI AABC NEBB TIA EIA ICEA ETL AGA API AWS ACI AISC DIN NEC IPC IMC IBC UPC UMC MIL CFR OSHA CGA ASPE AMCA NZS`.split(" ");
// Common words and units are never an equipment prefix.
const prose = new Set([
  ...`ADD AISLE AND APPENDIX ASSET AT BUILDING BY CHAPTER CLASS COORD DAY DETAIL DIV DIVISION DRAWING DWG ELEC ELEV FLOOR FLOODED FOR FROM GRID IN ISSUED JANITOR KITCHEN LAUNDRY LEVEL LOBBY LOUNGE MAX MAXIMUM MIN MINIMUM MODEL NO NOTE OF ON OWNER PAGE PARKING PHASE PROGRESS REF REV REVISION ROOM SCALE SECTION SERVICE SHEET SI SIZE STORAGE THE TO TYPE VENDING VEST VOLUME ZONE KG KW KVA HZ GPM CFM PSI PSIG LBS RPM MBH BTU BTUH VAC VDC AMP AMPS FT MM`.split(" "),
  ...standards,
]);
// Families that are also units or common words. Without a hyphen they are a
// schedule value ("HP 15", "SF 270") far more often than equipment.
const ambiguous = new Set(
  `AS CB CR HP SF SL SP SS ST MS T`.split(" "),
);
const sheetPrefix = /^(?:A|C|E|F|G|I|ID|M|S|ST|STR|EL|ME|ARCH)$/;
// A standard, catalogue or manufacturer immediately before the identifier
// makes it a reference or a model number: "MSS SP-58", "SLOAN SS-3001".
const referenceBefore = new RegExp(
  `(?:^|[^A-Z])(?:${[
    ...standards,
    "STANDARD", "STD", "SPEC", "SPECIFICATION", "SERIES", "MODEL", "CAT", "CATALOG", "FIG", "FIGURE", "PART", "P/N", "NO", "NUMBER",
    "BELL & GOSSETT", "B&G", "CLEAVER BROOKS", "CLEAVER-BROOKS", "SLOAN", "AMTROL", "ZURN", "WATTS", "JAY R\\.? SMITH", "J\\.?R\\.? SMITH", "KOHLER", "AMERICAN STANDARD", "ELKAY", "HAWS", "TRANE", "CARRIER", "DAIKIN", "YORK", "LENNOX", "MITSUBISHI", "GREENHECK", "LOREN COOK", "TITUS", "KRUEGER", "NAILOR", "TACO", "ARMSTRONG", "GRUNDFOS", "AERCO", "LOCHINVAR", "RHEEM", "RUUD", "A\\.? ?O\\.? SMITH", "BRADFORD WHITE", "STATE INDUSTRIES", "VICTAULIC", "NIBCO", "APOLLO", "LEONARD", "POWERS", "SYMMONS", "CHICAGO FAUCETS", "T&S", "GUARDIAN", "SPEAKMAN", "ACORN", "BRADLEY", "MIFAB", "WADE", "JOSAM", "ZOELLER", "LIBERTY", "LIEBERT", "SQUARE D", "EATON", "CUTLER-HAMMER", "SIEMENS", "ASCO", "HONEYWELL", "BELIMO", "DWYER", "PENTAIR", "AURORA", "PATTERSON", "XYLEM", "BALDOR", "ABB", "DANFOSS", "YASKAWA", "MODINE", "REZNOR", "STERLING", "BERKO", "MARKEL", "QMARK", "RUSKIN", "POTTORFF", "NAILOR", "ANEMOSTAT", "METALAIRE", "HART & COOLEY", "SPIROTHERM", "SPIROVENT", "ARMSTRONG", "CANARIS", "BAC", "EVAPCO", "MARLEY", "AAON", "VALENT", "RENEWAIRE", "ENGINEERED AIR", "ENGA", "VIESSMANN", "NAVIEN", "RINNAI", "NORITZ", "HOLBY", "THERMON", "RAYCHEM", "WILKINS", "FEBCO", "CONBRACO",
  ].join("|")})\\)?(?:\\s+(?:GUIDES?|STANDARDS?|PRACTICE|SPECS?|MODEL|NO|NUMBER|SERIES|TYPE|FIG|CAT))*\\.?\\s*[#:]?\\s*$`,
);
// A quantity directly after the number: "AT 100%", "LAV 3/8\"", "HP 15 RPM".
const unitAfter =
  /^(?:\s*(?:%|PERCENT|-?FOOT|-?FEET|FT\b|INCH|"|”|″|'|’|°|DEG\b|VOLTS?\b|VAC\b|VDC\b|AMPS?\b|KW\b|KVA\b|HP\b|GPM\b|CFM\b|LBS?\b|PSIG?\b|MIN(?:UTES?)?\b|SECONDS?\b|HOURS?\b|HRS?\b|YEARS?\b|LF\b|GAL\b|MBH\b|BTUH?\b|TONS?\b|RPM\b|HZ\b|MM\b|LIFE\b)|\/\d+\s*(?:"|”|″|IN\b|INCH))/;

type Mention = {
  tags: string[];
  ranges: Array<[number, number]>;
  prefix: string;
  explicit: boolean;
  start: number;
  end: number;
  /** Context that marks a citation, quantity or prose rather than equipment. */
  doubtful: boolean;
  /** Prefix and number are written together, as in MD101 or BF001. */
  compact: boolean;
  /** A hyphen directly before the number, as in SF-1 but not SF 1 or CR-P2. */
  hyphenated: boolean;
};
function mentions(text: string): Mention[] {
  const original = text.replace(dashes, "-");
  const value = original.toUpperCase();
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
    const segments = body.split(/[-.]/).slice(1);
    const doubtful =
      // Specifications and notes are sentence case; drawing tags are capitals.
      /[a-z]/.test(original.slice(match.index, baseEnd)) ||
      referenceBefore.test(value.slice(Math.max(0, match.index - 24), match.index)) ||
      unitAfter.test(value.slice(end, end + 12)) ||
      /\d\.\d/.test(body) ||
      // Catalogue numbers: 1510-6G-SS-365T-L, 1100-A-X, 10-FOOT.
      segments.length > 2 ||
      // Catalogue numbers: FS-730-150, DA-45-840.
      segments.some((part) => /^\d{3,}/.test(part)) ||
      segments.some((part) => /^[A-Z]{3,}$/.test(part)) ||
      segments.some((part, index) => /^[A-Z]+$/.test(part) && /^[A-Z]+$/.test(segments[index + 1] ?? ""));
    result.push({
      tags: bodies.map((number) => `${prefix}-${number}`),
      ranges,
      prefix,
      explicit,
      start: match.index,
      end,
      doubtful,
      compact: !/[-\s]/.test(match[0].slice(prefix.length, match[0].length - match[3]!.length)),
      hyphenated: match[2] === "-",
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
  // Schedules put the manufacturer in the cell before the model number:
  // "CLEAVER BROOKS | CB-900", "AMTROL | ST-12V".
  const cellBefore = (word: TitleBlockWord) =>
    valid
      .filter(
        (w) =>
          w !== word &&
          w.right <= word.left + charWidth(word) * 0.3 &&
          word.left - w.right <= 0.08 &&
          Math.abs((w.top + w.bottom - word.top - word.bottom) / 2) <
            Math.min(height(w), height(word)) * 0.45,
      )
      .sort((a, b) => b.right - a.right)[0]?.text ?? "";
  const add = (word: TitleBlockWord, stacked = false) => {
    for (const found of mentions(word.text)) {
      const item = { ...found, hyphenated: found.hyphenated && !stacked };
      if (!item.doubtful && !word.text.slice(0, item.start).trim())
        item.doubtful = referenceBefore.test(cellBefore(word).toUpperCase().replace(dashes, "-"));
      for (const [index, tag] of item.tags.entries()) {
        // Give grouped tags distinct hit areas; otherwise the last link would
        // cover every other member of labels such as AC-1 A/B/C.
        const [start, end] = item.ranges[index]!;
        result.push({ ...item, tags: [tag], box: sliceBox(word, start, end) });
      }
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
    // A schedule header above its values ("HP" over "15") stacks the same
    // way, so a stacked tag is never treated as hyphenated.
    if (below)
      add(
        {
          text: `${prefix[1]}-${below.text.trim()}`,
          left: Math.min(first.left, below.left),
          right: Math.max(first.right, below.right),
          top: first.top,
          bottom: below.bottom,
        },
        true,
      );
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
type Vocabulary = { known: Set<string>; families: Set<string>; sheets: Set<string> };
function vocabulary(options: { knownTags?: string[]; sheetNumbers?: string[] }): Vocabulary {
  const known = new Set((options.knownTags ?? []).map(normalizeEquipmentTag));
  return {
    known,
    // A schedule that lists PHWP-1..3 makes PHWP a family for this project.
    families: new Set([...known].map((tag) => tag.replace(/-\d.*$/, ""))),
    sheets: new Set((options.sheetNumbers ?? []).map(normalizeEquipmentTag)),
  };
}
function plausible(item: Occurrence, automatic: boolean, words: Vocabulary) {
  const tag = item.tags[0]!;
  if (words.known.has(tag)) return true;
  if (words.sheets.has(tag)) return false;
  const baseFamily = item.prefix.split(/[-./]/)[0]!;
  const recognized =
    families.has(item.prefix) ||
    (item.explicit && words.families.has(item.prefix)) ||
    (item.explicit && baseFamily.length > 1 && families.has(baseFamily));
  if (item.prefix.split(/[-./]/).some((part) => prose.has(part))) return false;
  // References such as M-102 and room IDs S101 are not equipment. An explicitly
  // declared schedule tag can still use these prefixes.
  if (sheetPrefix.test(item.prefix) && /-\d{3,}/.test(tag)) return false;
  if (automatic) {
    if (item.doubtful) return false;
    const digits = /^\d*/.exec(tag.slice(item.prefix.length + 1))![0];
    // Equipment numbers are short. Longer ones are model numbers (SS-3103),
    // ZIP codes (TX 75211) or airflow (FCU over 1000) unless the project's
    // schedules use them.
    if (digits.length >= 4 && !words.families.has(item.prefix)) return false;
    // MD101, AD101, BF001, AS01 and room 148 under a WCO label are sheet and
    // room numbers; AHU1, DP41 and AHU 10-1 are equipment.
    if (!item.hyphenated && digits.length >= 3) return false;
    if (item.compact && digits.startsWith("0")) return false;
    if (!item.hyphenated && ambiguous.has(baseFamily)) return false;
    // BAS points such as RA.CO2 use dotted names.
    if (item.prefix.includes(".") && !words.families.has(item.prefix)) return false;
  }
  if (
    !item.explicit &&
    (!recognized || (automatic && item.prefix.length === 1))
  )
    return false;
  return recognized || (!automatic && item.explicit && item.prefix.length <= 8);
}
type TagOptions = { automatic?: boolean; knownTags?: string[]; sheetNumbers?: string[] };
export function equipmentTagCandidates(
  words: TitleBlockWord[],
  points: Array<{ x: number; y: number }>,
  options: TagOptions = {},
) {
  if (!points.length) return [];
  const left = Math.min(...points.map((p) => p.x)),
    right = Math.max(...points.map((p) => p.x)),
    top = Math.min(...points.map((p) => p.y)),
    bottom = Math.max(...points.map((p) => p.y));
  const context = vocabulary(options);
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
            plausible(item, options.automatic ?? false, context)
          );
        })
        .flatMap((item) => item.tags),
    ),
  ];
}
/** Every equipment tag on a page with its tight location, for a whole-sheet scan. */
export function equipmentTagsOnPage(words: TitleBlockWord[], options: Omit<TagOptions, "automatic"> = {}) {
  const context = vocabulary(options);
  return occurrences(words)
    .filter((item) => plausible(item, true, context))
    .map((item) => ({ ...item.box, text: item.tags[0]! }));
}
/** Every tag on a page with its locations, for looking up any tag later. Citations and model numbers are left out. */
export function equipmentTagIndex(words: TitleBlockWord[]) {
  const index = new Map<string, TitleBlockWord[]>();
  for (const item of occurrences(words))
    if (!item.doubtful)
      for (const tag of item.tags) index.set(tag, [...(index.get(tag) ?? []), { ...item.box, text: tag }]);
  return index;
}
/** The sheet number at the start of a sheet name: "M-101 FIRST FLOOR" → M-101. */
export function sheetNumberOfName(name: string) {
  const code = /^\s*([A-Z]{1,3}[-.]?\d{1,4}(?:\.\d{1,3})?[A-Z]?)(?![A-Z0-9])/i.exec(name.replace(dashes, "-"))?.[1];
  return code ? normalizeEquipmentTag(code) : null;
}
export function equipmentTagLocations(words: TitleBlockWord[], tag: string) {
  const normalized = normalizeEquipmentTag(tag);
  return occurrences(words)
    .filter((item) => item.tags.includes(normalized))
    .map((item) => ({ ...item.box, text: normalized }));
}
// Sheet codes: P-101, M1.01, FP-001, MD101, E-501A.
const sheetCode = /^[A-Z]{1,3}-?\d{1,4}(?:\.\d{1,3})?[A-Z]?$/;
const sheetIndexTitle =
  /\b(?:PLANS?|SCHEDULES?|DETAILS?|LEGENDS?|NOTES|DIAGRAMS?|ELEVATIONS?|SECTIONS?|SITE|DEMOLITION|COVER|INDEX|RISERS?|ENLARGED|ROOF|ISOMETRICS?|SPECIFICATIONS|ABBREVIATIONS|SCHEMATICS?|LAYOUTS?|SYMBOLS|TITLE)\b/;
const sheetReference =
  /\b(?:REFER\s+TO|SEE|REF\.?|SHEETS?|DWGS?\.?|DRAWINGS?)\s+(?:SHEETS?\s+|DRAWINGS?\s+|DWG\.?\s+)?((?:[A-Z]{1,3}-?\d{1,4}(?:\.\d{1,3})?[A-Z]?(?:\s*(?:,|AND|&|THRU|THROUGH|-)\s*)?)+)/g;
const detailCallout = /(?:^|[^A-Z0-9/])\d{1,2}[A-Z]?\s*\/\s*([A-Z]{1,3}-?\d{2,4}(?:\.\d{1,3})?[A-Z]?)(?![A-Z0-9/])/g;
/**
 * Sheet numbers of a drawing set: each sheet's title-block number, the
 * drawing index, and sheet references ("REFER TO P-001", detail "1/P-501").
 * A sheet number is a page, never equipment, even when it reads like P-101.
 */
export function drawingSheetNumbers(pages: Array<{ words: TitleBlockWord[] }>) {
  const sheets = new Set<string>();
  const addSheet = (text: string) => {
    const value = text.trim().toUpperCase().replace(dashes, "-");
    if (sheetCode.test(value)) sheets.add(normalizeEquipmentTag(value));
  };
  for (const { words } of pages) {
    const valid = words.filter(
      (w) => [w.left, w.right, w.top, w.bottom].every(Number.isFinite) && w.right > w.left && w.bottom > w.top && w.text.trim(),
    );
    // Product data sheets also put a code in the corner (WH1, P-17). Without a
    // sheet title, trust only codes shaped like sheet numbers.
    const identity = extractDrawingIdentity(valid);
    if (identity.title || /^\D*(?:\d{3}(?!\d)|\d{1,2}\.\d)/.test(identity.number)) addSheet(identity.number);
    for (const word of valid) {
      const text = word.text.toUpperCase().replace(dashes, "-");
      for (const match of text.matchAll(sheetReference))
        for (const code of match[1]!.split(/\s*(?:,|AND|&|THRU|THROUGH)\s*/))
          // Plain references need a sheet-like number; "SEE P-1" may be a pump.
          if (/\d{3}|\.\d/.test(code)) addSheet(code);
      for (const match of text.matchAll(detailCallout)) addSheet(match[1]!);
    }
    // A drawing index lists codes in a column with a sheet title beside each.
    const rows = valid.filter((word) => sheetCode.test(word.text.trim().toUpperCase().replace(dashes, "-")));
    const titled = rows.filter((code) => {
      const title = valid
        .filter(
          (w) =>
            w !== code &&
            w.left >= code.right - charWidth(code) * 0.3 &&
            w.left - code.right <= 0.15 &&
            Math.abs((w.top + w.bottom - code.top - code.bottom) / 2) < Math.min(height(w), height(code)) * 0.45,
        )
        .sort((a, b) => a.left - b.left)[0];
      return title && sheetIndexTitle.test(title.text.toUpperCase()) && !/\bROOM\b/i.test(title.text);
    });
    for (const code of titled)
      if (titled.filter((other) => Math.abs(other.left - code.left) < 0.004).length >= 3) addSheet(code.text);
  }
  return [...sheets];
}
export type EquipmentScheduleEntry = {
  tag: string;
  /** 1-based page of the indexed file. */
  page: number;
  box: TitleBlockWord;
  /** The schedule's title, such as "PUMP SCHEDULE". */
  title: string;
  /** The tag's row (or column, for a transposed schedule), cell by cell. */
  cells: string[];
};
const sameRow = (a: TitleBlockWord, b: TitleBlockWord) =>
  Math.abs((a.top + a.bottom - b.top - b.bottom) / 2) < Math.min(height(a), height(b)) * 0.45;
const scheduleHeader =
  /^(?:SYMBOL|TAG|MARK|NO\.?|NUMBER|ID|UNIT(?:\s*(?:NO\.?|NUMBER|TAG|ID))?|DESIGNATION|(?:PLAN|FIXTURE|EQUIP(?:MENT|\.)?)\s*(?:MARK|NO\.?|NUMBER|TAG|ID|SYMBOL)|(?:EQUIPMENT|FIXTURE|UNIT)\s*(?:TAG|MARK))$/i;
const panelLabel = /\bPANEL(?:BOARD)?\s*(?:NAME|DESIGNATION|NO\.?|TAG)?\s*[:#]?\s*["']?$/;
/** The words of a line around one word, as printed: "PUMP" "SCHEDULE" → "PUMP SCHEDULE". */
function lineAround(word: TitleBlockWord, words: TitleBlockWord[]) {
  const row = words.filter((w) => sameRow(w, word)).sort((a, b) => a.left - b.left);
  const at = row.indexOf(word);
  let first = at,
    last = at;
  const near = (a: TitleBlockWord, b: TitleBlockWord) => b.left - a.right <= Math.max(charWidth(a), charWidth(b)) * 2.5;
  while (first > 0 && near(row[first - 1]!, row[first]!)) first--;
  while (last < row.length - 1 && near(row[last]!, row[last + 1]!)) last++;
  return row
    .slice(first, last + 1)
    .map((w) => w.text.trim())
    .join(" ")
    .replace(/\s+/g, " ");
}
/**
 * Equipment listed in schedules, with the schedule title and the tag's row.
 * Tags come from identifier columns (by header, or a column of distinct tags
 * that each start a row) and panelboard headings, never from manufacturer or
 * model columns.
 */
export function equipmentSchedules(
  pages: Array<{ page?: number; words: TitleBlockWord[] }>,
  options: { sheetNumbers?: string[] } = {},
) {
  const sheets = new Set((options.sheetNumbers ?? drawingSheetNumbers(pages)).map(normalizeEquipmentTag));
  // A drawing index is a table of A-311, G-002... Codes of a discipline that
  // numbers its sheets this way are sheets, not equipment.
  const sheetFamilies = new Set([...sheets].map((sheet) => sheet.replace(/-\d.*$/, "")));
  const sheetLike = (tag: string) => sheetFamilies.has(tag.replace(/-\d.*$/, "")) && /-(?:\d{3}|0)/.test(tag);
  const entries: EquipmentScheduleEntry[] = [];
  const seen = new Set<string>();
  for (const [index, { page = index + 1, words: input }] of pages.entries()) {
    const words = input.filter(
      (w) => [w.left, w.right, w.top, w.bottom].every(Number.isFinite) && w.right > w.left && w.bottom > w.top && w.text.trim(),
    );
    // "SCHEDULE 80" is pipe wall thickness, not a table title.
    const titles = words.filter(
      (w) => /\bSCHEDULES?\b(?!\s*\d)/i.test(w.text) && !/\b(?:SEE|REFER|PER)\b/i.test(w.text),
    );
    if (!titles.length) continue;
    const titleFor = (cell: TitleBlockWord) => {
      const title = titles
        .filter((t) => t.bottom <= cell.top + 0.002 && cell.top - t.bottom < 0.5 && cell.left >= t.left - 0.35 && cell.left <= t.right + 0.1)
        .sort((a, b) => cell.top - a.bottom - (cell.top - b.bottom))[0];
      return title ? lineAround(title, words) : "";
    };
    // A cell holding exactly one tag, or a grouped tag such as P-1A/B.
    const cells = words.flatMap((word) => {
      const text = word.text.trim();
      const found = mentions(text);
      if (
        !found.length ||
        found[0]!.start !== 0 ||
        found.at(-1)!.end !== text.length ||
        found.some(
          (m) =>
            m.doubtful ||
            // O2, N2O and RA.CO2 are gases and control points.
            (m.compact && /^(?:O|N|H|C|CO|NO)$/.test(m.prefix)) ||
            m.prefix.includes(".") ||
            m.prefix.split(/[-./]/).some((part) => prose.has(part)) ||
            // 500K and 4000K are colour temperatures.
            m.tags.some((tag) => sheets.has(tag) || sheetLike(tag) || /^\D*-\d{4}|\d{3}K$/.test(tag)),
        )
      )
        return [];
      return [{ word, tags: found.flatMap((m) => m.tags), prefix: found[0]!.prefix }];
    });
    type Cell = (typeof cells)[number];
    const rowOf = (cell: Cell) =>
      words
        .filter((w) => w !== cell.word && sameRow(w, cell.word) && w.left >= cell.word.right - 0.001 && w.left - cell.word.right < 0.6)
        .sort((a, b) => a.left - b.left);
    const add = (cell: Cell, cellsAfter: TitleBlockWord[]) => {
      const title = titleFor(cell.word);
      // Stop the row at a large gap: the next table on the sheet.
      const row: string[] = [];
      let last = cell.word;
      for (const w of cellsAfter) {
        if (w.left - last.right > 0.12) break;
        row.push(w.text.trim().replace(/\s+/g, " "));
        last = w;
      }
      for (const tag of cell.tags) {
        const key = `${page}:${tag}`;
        if (seen.has(key)) continue;
        seen.add(key);
        entries.push({ tag, page, box: cell.word, title, cells: row.slice(0, 16) });
      }
    };
    // 1. A column under an identifier header.
    const accepted = new Set<Cell>();
    for (const header of words.filter((w) => scheduleHeader.test(w.text.trim()))) {
      let previous = header.bottom;
      const column = cells
        .filter(
          (cell) =>
            cell.word.top >= header.bottom - 0.001 &&
            Math.abs(center(cell.word) - center(header)) <= Math.max(header.right - header.left, cell.word.right - cell.word.left, 0.006) * 0.8,
        )
        .sort((a, b) => a.word.top - b.word.top);
      for (const cell of column) {
        // Stop at a gap between tables. A TAG header near the top of the page
        // must not authorize model numbers in a different table far below it.
        if (cell.word.top - previous > 0.2) break;
        previous = cell.word.bottom;
        accepted.add(cell);
      }
    }
    // 2. A column of distinct tags of one family, each starting a data row.
    const starts = cells.filter((cell) => !accepted.has(cell) && rowOf(cell).length >= 2);
    for (const cell of starts) {
      const column = starts.filter(
        (other) =>
          other.prefix === cell.prefix &&
          (Math.abs(other.word.left - cell.word.left) < 0.004 || Math.abs(center(other.word) - center(cell.word)) < 0.004) &&
          Math.abs(other.word.top - cell.word.top) < 0.25,
      );
      const tags = column.flatMap((other) => other.tags);
      const known = families.has(cell.prefix) || column.every((other) => /^\D*-\d{1,2}[A-Z]?$/.test(other.tags[0]!));
      if (column.length >= 2 && new Set(tags).size === tags.length && known && titleFor(cell.word)) accepted.add(cell);
    }
    for (const cell of accepted) add(cell, rowOf(cell));
    // 3. Transposed schedules: a header row of tags with values beneath.
    for (const cell of cells) {
      if (accepted.has(cell)) continue;
      const row = cells.filter(
        (other) => other.prefix === cell.prefix && sameRow(other.word, cell.word) && Math.abs(other.word.left - cell.word.left) < 0.4,
      );
      const tags = row.flatMap((other) => other.tags);
      const below = (c: Cell) =>
        words.filter(
          (w) =>
            w.top >= c.word.bottom - 0.001 &&
            w.top - c.word.bottom < height(c.word) * 3 &&
            Math.abs(center(w) - center(c.word)) < Math.max(c.word.right - c.word.left, 0.01),
        );
      if (
        row.length >= 2 &&
        new Set(tags).size === tags.length &&
        (families.has(cell.prefix) || row.every((other) => /^\D*-\d{1,2}[A-Z]?$/.test(other.tags[0]!))) &&
        row.every((other) => below(other).length) &&
        titleFor(cell.word)
      ) {
        const column = words
          .filter((w) => w.top >= cell.word.bottom - 0.001 && w.top - cell.word.bottom < 0.4 && Math.abs(center(w) - center(cell.word)) < Math.max(cell.word.right - cell.word.left, 0.01))
          .sort((a, b) => a.top - b.top);
        const kept: TitleBlockWord[] = [];
        let last = cell.word;
        for (const w of column) {
          if (w.top - last.bottom > height(cell.word) * 3) break;
          kept.push(w);
          last = w;
        }
        add(cell, kept.map((w) => ({ ...w, left: cell.word.right, right: cell.word.right + 0.001 })));
      }
    }
    // 4. Panelboard schedules name the panel in a heading: "PANEL: LP-1".
    for (const word of words) {
      const text = word.text.toUpperCase().replace(dashes, "-");
      for (const found of mentions(text)) {
        const before = text.slice(0, found.start) || ` ${lineAround(word, words).toUpperCase().split(text)[0] ?? ""}`;
        if (!panelLabel.test(before) || found.doubtful || found.tags.some((tag) => sheets.has(tag) || sheetLike(tag))) continue;
        for (const tag of found.tags) {
          if (seen.has(`${page}:${tag}`)) continue;
          seen.add(`${page}:${tag}`);
          entries.push({ tag, page, box: word, title: lineAround(word, words), cells: [] });
        }
      }
    }
  }
  return entries;
}
/** Tags this project defines in its schedules. */
export function equipmentScheduleTags(
  pages: Array<{ page?: number; words: TitleBlockWord[] }>,
  options: { sheetNumbers?: string[] } = {},
) {
  return [...new Set(equipmentSchedules(pages, options).map((entry) => entry.tag))];
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

/** PDF document destinations retain both immutable version and exact tag position. */
export function equipmentDocumentDestination(input: {
  jobId: string; documentId: string; versionId: string;
  name: string; tag: string; page: number; box: TitleBlockWord;
}) {
  const { box } = input;
  const viewport = {
    center: { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 },
    zoom: Math.min(10, Math.max(2, 0.35 / Math.max(box.right - box.left, box.bottom - box.top))),
  };
  return makeSnapshotSource(`/dashboard/jobs/${input.jobId}/documents`, {
    version: 1,
    document: { jobId: input.jobId, documentId: input.documentId, versionId: input.versionId, tab: "details", viewer: "preview" },
    pdf: { page: input.page, viewport, zoom: viewport.zoom, left: 0, top: 0 },
  }, `${input.tag} — ${input.name}`);
}

/** Older automatic links stored a tag in the label but only a document URL. */
export function legacyEquipmentDocumentLink(link: { label?: string; url?: string }, jobId: string) {
  const tag = link.label?.split(" — ")[0]?.trim();
  if (!tag || tag.length > 40 || !link.label?.includes(" — ") || !/^[A-Z][A-Z0-9]*-\d[A-Z0-9-]*$/i.test(tag)) return null;
  try {
    const url = new URL(link.url ?? "", "https://equipment.invalid");
    if (url.origin !== "https://equipment.invalid" || url.pathname !== `/dashboard/jobs/${jobId}/documents` || url.hash) return null;
    const id = url.searchParams.get("document");
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    return { tag, documentId: id };
  } catch { return null; }
}
