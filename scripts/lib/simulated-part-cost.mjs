import { createHash } from "node:crypto";

export const SIMULATION_VERSION = "foremanhq-estimate-v1-2026-10-11";
export const SIMULATION_MARKER = `[${SIMULATION_VERSION}]`;

// Illustrative CAD costs, before tax, freight, and markup. These are deliberately
// hand-selected assumptions, not manufacturer or supplier quotes.
const normalize = (value) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const numberAtStart = (value) => {
  const mixed = /^(\d+)[ -]+(\d+)\/(\d+)/.exec(value);
  if (mixed)
    return { value: +mixed[1] + +mixed[2] / +mixed[3], end: mixed[0].length };
  const fraction = /^(\d+)\/(\d+)/.exec(value);
  if (fraction)
    return { value: +fraction[1] / +fraction[2], end: fraction[0].length };
  const decimal = /^(\d+(?:\.\d+)?)/.exec(value);
  return decimal ? { value: +decimal[1], end: decimal[0].length } : null;
};

export function primaryDiameter(part) {
  // Explicit units in the name win over inconsistent imported size metadata.
  for (const source of [part.displayName, part.sizeLabel]) {
    const text = normalize(source);
    const parsed = numberAtStart(text);
    if (!parsed) continue;
    const tail = text.slice(parsed.end).trimStart();
    const explicitUnit = /^(?:"|″|in\b)/i.test(tail)
      ? "in"
      : /^mm\b/i.test(tail)
        ? "mm"
        : null;
    const unit = explicitUnit ?? part.sizeUnit ?? "in";
    const inches = unit === "mm" ? parsed.value / 25.4 : parsed.value;
    if (inches > 0 && inches <= 36) return { inches, assumed: false };
  }
  const nominal = Number(part.nominal);
  const inches = part.sizeUnit === "mm" ? nominal / 25.4 : nominal;
  if (inches > 0 && inches <= 36) return { inches, assumed: false };
  return { inches: 2, assumed: true };
}

function pipeRate(material, diameter, text) {
  if (/copper/.test(material)) {
    const wall = /type k\b/.test(text) ? 1.4 : /type m\b/.test(text) ? 0.82 : 1;
    return 3.15 * (diameter / 0.5) ** 1.65 * wall;
  }
  if (/pex|wirsbo/.test(material)) return 0.55 * (diameter / 0.5) ** 1.85;
  if (/carbon|black|galvanized|grooved/.test(material))
    return 2.65 * diameter ** 1.45;
  if (/cast/.test(material)) return 6.2 * (diameter / 2) ** 1.55;
  if (/xfr/.test(material)) return 2.8 * (diameter / 2) ** 1.8;
  if (/sch 80/.test(material)) return 1.75 * diameter ** 1.8;
  if (/sch 40/.test(material)) return 1.05 * diameter ** 1.75;
  if (/dr25/.test(material)) return 4.2 * (diameter / 4) ** 1.8;
  if (/dr35|bds/.test(material)) return 2.3 * (diameter / 4) ** 1.65;
  const rate =
    (0.58 + 0.32 * diameter ** 1.8) * (/pvc/.test(material) ? 1.2 : 1);
  return rate * (/cell core/.test(text) ? 0.8 : 1);
}

function fittingBase(material, diameter) {
  if (/copper press/.test(material)) return 9.5 * (diameter / 0.5) ** 1.7;
  if (/carbon steel press/.test(material)) return 16 * (diameter / 0.5) ** 1.65;
  if (/copper/.test(material)) return 2.5 * (diameter / 0.5) ** 1.8;
  if (/galvanized/.test(material)) return 3.65 * (diameter / 0.5) ** 1.7;
  if (/black|carbon/.test(material)) return 2.8 * (diameter / 0.5) ** 1.7;
  if (/grooved/.test(material)) return 32 * (diameter / 2) ** 1.8;
  if (/cast/.test(material)) return 17.5 * (diameter / 2) ** 1.8;
  if (/rubber|fernco/.test(material)) return 9.5 * (diameter / 2) ** 1.45;
  if (/dr25/.test(material)) return 42 * (diameter / 4) ** 2;
  if (/dr35/.test(material)) return 29 * (diameter / 4) ** 2;
  if (/bds/.test(material)) return 12 * (diameter / 4) ** 1.8;
  if (/pex|wirsbo/.test(material)) return 2.65 * (diameter / 0.5) ** 1.5;
  if (/brass/.test(material)) return 5 * (diameter / 0.5) ** 1.7;
  const premium = /xfr/.test(material)
    ? 2.1
    : /sch 80/.test(material)
      ? 2.5
      : /sch 40/.test(material)
        ? 1.3
        : /pvc/.test(material)
          ? 1.2
          : 1;
  return (1.35 + 0.8 * diameter ** 2) * premium;
}

function fittingMultiplier(text) {
  if (/expansion joint|expansion coupling/.test(text)) return 6;
  if (/test ball(?:oo|o)n/.test(text)) return 7;
  if (/double.*(?:tee|ty|wye)|(?:tee|ty|wye).*double/.test(text)) return 3.8;
  if (/trap\b/.test(text)) return 3.2;
  if (/cross\b/.test(text)) return 3.1;
  if (/union\b/.test(text)) return 2.7;
  if (/flange\b/.test(text)) return 2.7;
  if (/wye|\bty\b|\btee\b/.test(text)) return 2.1;
  if (/clean.?out|c\/o/.test(text)) return 1.8;
  if (/elbow|bend|\b90\b|\b45\b|22.?1\/2|11.?1\/4/.test(text))
    return /long|sweep/.test(text) ? 1.7 : 1.35;
  if (/bushing|cap\b|plug\b/.test(text)) return 0.7;
  if (/adapter|adaptor|transition/.test(text)) return 1.5;
  if (/nipple/.test(text)) return 0.85;
  return 1;
}

// Hardware prices are per base piece, not the entire named box. Existing
// supplier order multiples determine how the app rounds purchase quantities.
const hardwareRules = [
  [/rotary hammer/, 399, "power tool"],
  [/20v.*battery|battery.*xr5/, 149, "tool battery"],
  [/ladder/, (t) => 130 + (Number(/(\d+)'/.exec(t)?.[1]) || 6) * 34, "ladder"],
  [/first aid kit/, 69, "first aid kit"],
  [/harness/, 95, "safety harness"],
  [/rope grab/, 110, "fall protection"],
  [/lanyard/, 85, "fall protection"],
  [/scrutool.*kit/, 145, "installation kit"],
  [
    /holesaw/,
    (t) => 13 + (numberAtStart(t.split("mhs ")[1] ?? "")?.value ?? 2) * 7,
    "hole saw",
  ],
  [/sds.*bit|depth control|stop drill/, 22, "masonry bit"],
  [/jobber.*drill/, 8, "drill bit"],
  [/insert bit|nut setter|magnetic socket/, 4.25, "driver bit"],
  [
    /threaded rod/,
    (t) =>
      (/stainless/.test(t) ? 48 : 12) *
      ((numberAtStart(t)?.value ?? 0.375) / 0.375) ** 1.5,
    "listed rod length",
  ],
  [/strut.*bracket/, 44, "strut bracket"],
  [
    /strut,|strut.*(?:solid|slot)/,
    (t) => (/stainless/.test(t) ? 155 : 34) * (/20ft/.test(t) ? 2 : 1),
    "listed strut length",
  ],
  [/post base/, 28, "strut base"],
  [/hole.*(?:angle|plate)|square washer/, 2.8, "strut hardware"],
  [/beam clamp/, 4.5, "beam clamp"],
  [/rod hanger/, 1.5, "rod hanger"],
  [
    /spring.*nut|spring clamp nut/,
    (t) => (/stainless/.test(t) ? 2.1 : 0.9),
    "strut nut",
  ],
  [/ceiling flange/, 3.5, "support flange"],
  [/setting tool|steeting tool/, 15, "anchor setting tool"],
  [
    /dropin|expansion anchor|twister anchor|zamac|rod couplings/,
    0.95,
    "anchor or rod coupling",
  ],
  [/wall plug/, 0.12, "wall plug"],
  [
    /washer/,
    (t) => (/stainless/.test(t) ? 0.32 : /lock/.test(t) ? 0.06 : 0.12),
    "washer",
  ],
  [/hex nut/, (t) => (/stainless/.test(t) ? 0.52 : 0.18), "nut"],
  [/\bbolt\b|\bhcs\b/, (t) => (/stainless/.test(t) ? 1.45 : 0.95), "bolt"],
  [
    /screw|scrw|self drill|scru-it|mod truss/,
    (t) => (/stainless/.test(t) ? 0.22 : /scru-it/.test(t) ? 0.32 : 0.09),
    "screw",
  ],
  [/nails|staples/, 0.035, "nail or staple"],
  [/cable tie/, (t) => (/24"|120lb/.test(t) ? 0.5 : 0.1), "cable tie"],
  [/nylon.*clamp|clamp.*nylon|positioning clip/, 0.85, "support clip"],
  [/earplug/, 0.2, "earplug pair"],
  [/n95.*mask/, 2.5, "mask"],
  [/garbage bag/, 0.5, "bag"],
  [/safety glass|safety glasses/, 5.5, "safety glasses"],
  [/faceshield/, 22, "face shield"],
  [/traffic vest/, 18, "visibility vest"],
  [/glove|stealth phoenix|pollycotton/, 7, "glove pair"],
  [/blade|port bim/, 6.5, "blade"],
  [
    /wheel|disc|enduroflex|edge.*(?:flat|x)|supra|smt925|ks\/supra/,
    4.5,
    "abrasive disc",
  ],
  [/tarp/, 79, "tarp"],
  [/ratchet strap/, 24, "strap"],
  [/silicone|nuflex/, 8.5, "sealant tube"],
  [/contact cement/, 24, "cement container"],
  [
    /tape/,
    (t) =>
      /foil/.test(t) ? 18 : /duct/.test(t) ? 9 : /packing/.test(t) ? 4 : 2.75,
    "tape roll",
  ],
  [/rags|wipers/, 42, "listed bag or bucket"],
  [/paper towel/, 7.5, "towel roll"],
  [/pumice lotion/, 23, "cleaner container"],
  [/grease/, 8, "grease cartridge"],
  [/cord cap/, 12, "cord cap"],
  [/halogen bulb/, 9, "bulb"],
  [/industrial.*battery/, 1.25, "battery"],
  [/paint brush/, 2, "brush"],
  [/m1400|paint marker/, 9, "marking paint or marker"],
  [/marker|crayon/, 2, "marker"],
  [/chalk/, 4, "chalk container"],
];

export function estimatePartCost(part) {
  const name = normalize(part.displayName).toLowerCase();
  const text = `${name} ${normalize(part.description).toLowerCase()}`;
  const category = normalize(part.category).toLowerCase();
  const material = (normalize(part.material) || name).toLowerCase();
  const diameter = primaryDiameter(part);
  const warnings = [];
  let cost;
  let rule;
  let basis = "per each";
  if (/hardware|tools|equipment/i.test(part.catalog ?? "")) {
    const match = hardwareRules.find(([pattern]) => pattern.test(name));
    cost = match
      ? typeof match[1] === "function"
        ? match[1](name)
        : match[1]
      : 12.5;
    rule = match?.[2] ?? "generic hardware allowance";
    if (!match) warnings.push("Unrecognized item; generic allowance");
    basis = `per ${rule.replace(/^listed /, "")}`;
  } else if (/toilet|urinal/.test(text)) {
    cost = /urinal/.test(text) ? 425 : 285;
    rule = "fixture";
  } else if (/faucet/.test(text)) {
    cost = /kitchen/.test(text) ? 165 : 115;
    rule = "faucet";
  } else if (/sink/.test(text)) {
    cost = /kitchen/.test(text) ? 225 : 95;
    rule = "sink";
  } else if (/solder.*(?:97\/3|lead free)|97\/3.*solder/.test(text)) {
    cost = 39;
    rule = "solder";
    basis = "per listed solder roll";
  } else if (/flux brush|roller|brush in bottle/.test(text)) {
    cost = /roller/.test(text) ? 12 : /bottle/.test(text) ? 9 : 1.75;
    rule = "application tool";
  } else if (
    /cement|primer|solder paste|lubricant|cutting oil|gritcloth/.test(text) ||
    category === "glue"
  ) {
    const gallon = /1\s*gal|gallon/.test(name);
    const large = /4\s*l\b/.test(name);
    cost = /gritcloth/.test(text)
      ? 16
      : /solder paste/.test(text)
        ? 18
        : /oil/.test(text)
          ? large
            ? 38
            : 15
          : /lubricant/.test(text)
            ? 18
            : /primer/.test(text)
              ? 23
              : gallon
                ? 82
                : 19;
    rule = "consumable";
    basis = "per listed container or roll";
  } else if (/tracer wire/.test(text)) {
    cost = 95;
    rule = "tracer wire";
    basis = "per listed wire roll";
  } else if (/cutter/.test(text)) {
    cost = /internal/.test(text) ? 42 : 28;
    rule = "cutting tool";
  } else if (/hanger|riser clamp|bend support|pipe clip/.test(text)) {
    cost =
      (2 + 1.25 * diameter.inches ** 1.25) *
      (/riser/.test(text) ? 1.9 : /light/.test(text) ? 0.75 : 1);
    if (/pipe clip/.test(text)) cost = 0.5 + 0.6 * diameter.inches;
    rule = "pipe support";
  } else if (/valve/.test(text) || category === "valves") {
    cost =
      22 *
      (diameter.inches / 0.5) ** 1.55 *
      (/check/.test(text) ? 1.45 : /gate/.test(text) ? 1.15 : 1);
    rule = "valve";
  } else if (
    (category === "pipe" || /\bpipe\b|aquapex/.test(text)) &&
    !/compression|adapter|adaptor|coupl|fitting/.test(text)
  ) {
    // Prefer the display name; some older descriptions have a conflicting length.
    const lengthMatch =
      /(?:\bx\s*)?(\d+(?:\.\d+)?)\s*(?:ft\b|foot\b|feet\b|')/.exec(name);
    const defaultLength = /copper|carbon|black|galvanized/.test(material)
      ? 20
      : /pex|wirsbo/.test(material)
        ? 100
        : /cast/.test(material)
          ? 10
          : /dr35|dr25|bds/.test(material)
            ? 13
            : /sch 80/.test(material)
              ? 20
              : /abs|dwv|xfr/.test(material)
                ? 12
                : 10;
    const length = lengthMatch ? Number(lengthMatch[1]) : defaultLength;
    cost = pipeRate(material, diameter.inches, text) * length;
    rule = "pipe";
    basis = `per ${length} ft ${/coil|pex|wirsbo/.test(text) && length >= 100 ? "coil" : "length"}${lengthMatch ? "" : " (assumed standard length)"}`;
    if (!lengthMatch)
      warnings.push("Length unspecified; assumed standard length");
  } else {
    cost = fittingBase(material, diameter.inches) * fittingMultiplier(text);
    rule = "fitting";
  }
  if (
    ["pipe", "fitting", "valve", "pipe support"].includes(rule) &&
    diameter.assumed
  )
    warnings.push("Size missing or malformed; assumed 2 inch diameter");
  // Small repeatable variation keeps simulations natural. Equal catalog entries
  // receive equal estimates across organizations and across subsequent runs.
  const digest = createHash("sha256")
    .update(`${name}|${material}|${rule}`)
    .digest();
  const variation = 0.95 + (digest.readUInt16BE(0) / 65535) * 0.1;
  const precision = cost < 1 ? 10000 : 100;
  const amount = Math.max(
    0.01,
    Math.round(cost * variation * precision) / precision,
  );
  if (!Number.isFinite(amount) || amount > 999_999)
    throw new Error(`Invalid estimate for ${part.id ?? part.displayName}`);
  return {
    unitCost: amount.toFixed(4),
    currency: "CAD",
    basis,
    rule,
    warnings,
  };
}

export function estimateNote(estimate) {
  return `${SIMULATION_MARKER} SIMULATED ESTIMATE ONLY. CAD ${estimate.basis}; before tax, freight and markup. Guessed from material, size and item type; not a supplier quote. Replace with verified pricing when available.${estimate.warnings.length ? ` Assumptions: ${estimate.warnings.join("; ")}.` : ""}`;
}
