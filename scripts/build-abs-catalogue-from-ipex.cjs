#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SOURCE = path.join(
  process.cwd(),
  "tmp/abs-ipex/CDN-ABS-DWV-Fittings-XLS-June-1-2026.xlsx",
);
const OUTPUT = path.join(process.cwd(), "data/catalogue/abs-catalogue.json");

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  const keep = new Set([
    "ABS",
    "DWV",
    "C/O",
    "SJ",
    "SP",
    "H",
    "FPT",
    "MPT",
    "CI",
    "COP",
    "TY",
    "LSI",
    "RSI",
    "W/",
    "P",
  ]);
  return normalize(value)
    .toLowerCase()
    .split(" ")
    .map((word) => {
      const upper = word.toUpperCase();
      if (keep.has(upper)) return upper;
      if (/^\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .replace(/\bW\/\b/g, "w/")
    .replace(/\bADPT\b/gi, "Adapter")
    .replace(/\bOTLT\b/gi, "Outlet")
    .replace(/\bPTRAP\b/gi, "P Trap")
    .replace(/\bP-TRAP\b/gi, "P Trap")
    .replace(/\bTRAYPLUG\b/gi, "Tray Plug")
    .replace(/CONT\./gi, "Continuous")
    .replace(/SWIV\./gi, "Swivel")
    .replace(/PERM\./gi, "Permanent")
    .replace(/ADJ\./gi, "Adjustable")
    .replace(/RED\./gi, "Reducing")
    .replace(/CLOSETFLANGE/gi, "Closet Flange")
    .replace(/OFFSETFLANGE/gi, "Offset Flange")
    .replace(/\bMLD\b/gi, "Molded")
    .replace(/\bJT\b/gi, "Joint")
    .replace(/\bTHR\b/gi, "Threaded")
    .replace(/GALVANIZEDPIPE/gi, "Galvanized Pipe");
}

function decimalToFraction(num) {
  if (Number.isInteger(num)) return String(num);
  const whole = Math.floor(Math.abs(num));
  const fractional = Math.abs(num) - whole;
  const sixteenths = Math.round(fractional * 16);
  if (sixteenths === 0) return String(num < 0 ? -whole : whole);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  return `${num < 0 ? "-" : ""}${whole > 0 ? `${whole}-` : ""}${sixteenths / divisor}/${16 / divisor}`;
}

function parseSizeNumber(sizeNominal) {
  const first = normalize(sizeNominal).split(/\s*(?:x|×)\s*/i)[0] ?? "";
  const mixed = /^(\d+)\s*[- ]\s*(\d+)\/(\d+)$/.exec(first);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(first);
  return Number.isFinite(number) ? number : null;
}

function normalizeSizeToken(token) {
  return normalize(token)
    .replace(/[”″"]/g, "")
    .replace(/\s*(?:inches|inch|in)\s*$/i, "")
    .trim()
    .replace(/\s+/g, "-");
}

function formatSizeLabel(sizeNominal) {
  return normalize(sizeNominal)
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => {
      const parsed = parseSizeNumber(part);
      return `${parsed == null ? part : decimalToFraction(parsed)}"`;
    })
    .join(" x ");
}

function expandConnections(value) {
  return normalize(value)
    .replace(/([A-Z])((?:H|SP|MPT|FPT|SJ|NUT)x)/g, "$1 $2")
    .replace(/HxHxHxHSI/g, "H x H x H x HSI")
    .replace(/HxHxHxH/g, "H x H x H x H")
    .replace(/HxHxFPT/g, "H x H x FPT")
    .replace(/HxHxH/g, "H x H x H")
    .replace(/HxHx/g, "H x H x")
    .replace(/HxH/g, "H x H")
    .replace(/HxSP/g, "H x SP")
    .replace(/HxMPT/g, "H x MPT")
    .replace(/NUTxH/g, "NUT x H")
    .replace(/SPxNUT/g, "SP x NUT")
    .replace(/SPxPLASTIC NUT/g, "SP x PLASTIC NUT")
    .replace(/SPxH/g, "SP x H")
    .replace(/SPXH/g, "SP x H")
    .replace(/SPxSP/g, "SP x SP")
    .replace(/SPXSP/g, "SP x SP")
    .replace(/SPxFPT/g, "SP x FPT")
    .replace(/HxSJ/g, "H x SJ")
    .replace(/HxFPT/g, "H x FPT")
    .replace(/MPTxH/g, "MPT x H")
    .replace(/\s+/g, " ");
}

function isHubOnly(connection) {
  if (/^HUB$/i.test(normalize(connection))) return true;
  return /^H(?:\s*x\s*H)*(?:\s*x\s*HSI)?$/i.test(normalize(connection));
}

function splitRawDescription(raw) {
  const desc = normalize(raw);
  const match = /^(.+?)\s+ABS(?:\s+DWV)?\s+(.+)$/.exec(desc);
  if (!match) return null;
  const prefix = match[1];
  let rest = normalize(match[2]);
  if (/^DWV\s+/i.test(rest)) rest = rest.replace(/^DWV\s+/i, "");
  const tokens = prefix.split(/x/i).map(normalize).filter(Boolean);
  const sizes = [];
  const angles = [];
  for (const token of tokens) {
    if (/\d\s*D$/i.test(token)) angles.push(token.replace(/\s*D$/i, ""));
    else if (/"/.test(token)) sizes.push(normalizeSizeToken(token));
  }
  return { desc, sizes, angles, rest: expandConnections(rest) };
}

function cleanLabel(parsed) {
  let label = parsed.rest;
  label = normalize(label.replace(/\bDRAINWAY ABS\b/gi, ""));
  const connectionMatch = /(\b(?:H|SP|MPT|FPT|SJ|NUT)\s*x\s*(?:H|SP|SJ|FPT|MPT|NUT|HSI)(?:\s*x\s*(?:H|SP|SJ|FPT|MPT|NUT|HSI))*|\bHUB\b|\bSP\b|\bSJ\b|\bFPT\b|\bMPT\b)$/i.exec(label);
  const connection = connectionMatch ? normalize(connectionMatch[0]) : "";
  if (connection) label = normalize(label.slice(0, -connection.length));

  label = label
    .replace(/\bSANTEE\b/gi, "SAN TEE")
    .replace(/\bSAN TEE\b/gi, "TY")
    .replace(/\bLSI TY\b/gi, "LSI TY")
    .replace(/\bRSI TY\b/gi, "RSI TY")
    .replace(/\bELBOW\b/gi, "")
    .replace(/\bLONG\b/gi, "Long")
    .replace(/\bEXTRA LONG\b/gi, "Extra Long")
    .replace(/\bFLUSH BUSHING\b/gi, "Flush Bushing")
    .replace(/\bBUSHING\b/gi, "Bushing")
    .replace(/\bCOUPLING\b/gi, "Coupling")
    .replace(/\bWYE\b/gi, "Wye")
    .replace(/\bCOMBO\b/gi, "Combo")
    .replace(/\bTRAPADPT\b/gi, "Trap Adapter")
    .replace(/\bADPT\b/gi, "Adapter")
    .replace(/\bCLOSET FLANGE\b/gi, "Closet Flange")
    .replace(/\bC\/O\b/gi, "C/O");

  if (/\bCoupling\b/i.test(label) && parsed.sizes.length > 1 && !/Reduc/i.test(label)) {
    label = label.replace(/\bCoupling\b/i, "Reducing Coupling");
  }
  if (/\bBushing\b/i.test(label) && parsed.sizes.length > 1 && !/Reduc|Red\.|Flush|Adapter/i.test(label)) {
    label = label.replace(/\bBushing\b/i, "Reducing Bushing");
  }

  label = titleCase(label);
  if (parsed.angles.length) {
    const angle = parsed.angles.join(" x ");
    if (/\bWye\b/i.test(label) && angle === "45") {
      // A 45 is implied for wyes; preserve it in aliases/source.
    } else {
      label = normalize(`${angle} ${label}`);
    }
  }
  if (connection && !isHubOnly(connection)) label = normalize(`${label} ${connection}`);
  return normalize(label);
}

function unique(values) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function rowToPart(row) {
  const raw = normalize(row["Prod-Desc"]);
  if (!/\bABS\b/i.test(raw)) return { skipped: "non-ABS accessory row" };
  if (normalize(row["Obsolete/No Longer Replnsh."])) {
    return { skipped: "obsolete/no longer replenished" };
  }
  const parsed = splitRawDescription(raw);
  if (!parsed?.sizes.length) return { skipped: "could not parse ABS size prefix" };
  const sizeNominal = parsed.sizes.join(" x ");
  const description = cleanLabel(parsed);
  const displayName = `${formatSizeLabel(sizeNominal)} ABS ${description}`;
  const aliases = unique([
    "IPEX ABS DWV",
    "IPEX Drain-Way ABS DWV",
    "ABS DWV",
    raw,
    `IPEX ${raw}`,
    row["P-Code"],
    row["UPC-Code"],
    row["Universal Number"],
    parsed.rest,
    parsed.angles.length ? `${parsed.angles.join(" x ")} ${description}` : "",
  ]);
  return {
    catalog: "Plumbing",
    category: "Fitting",
    material: "ABS",
    sizeNominal,
    sizeUnit: "in",
    displayName,
    description,
    imageUrl: "",
    aliases,
    manufacturerSources: ["ipexAbsDwvFittingsPriceList"],
    supplierParts: [],
    sourcePCode: normalize(row["P-Code"]),
    sourceUpc: normalize(row["UPC-Code"]),
    sourceUniversalNumber: normalize(row["Universal Number"]),
    sourceDescription: raw,
    sourcePer: normalize(row["/Per"]),
    sourceListPrice: normalize(row[" List Price "]),
  };
}

function mergeRows(rows) {
  const byName = new Map();
  for (const row of rows) {
    const existing = byName.get(row.displayName);
    if (!existing) {
      byName.set(row.displayName, row);
      continue;
    }
    existing.aliases = unique([
      ...(existing.aliases ?? []),
      ...(row.aliases ?? []),
      row.displayName,
      row.description,
    ]);
    existing.sourcePCode = unique([existing.sourcePCode, row.sourcePCode]).join("; ");
    existing.sourceUpc = unique([existing.sourceUpc, row.sourceUpc]).join("; ");
    existing.sourceUniversalNumber = unique([
      existing.sourceUniversalNumber,
      row.sourceUniversalNumber,
    ]).join("; ");
    existing.sourceDescription = unique([
      existing.sourceDescription,
      row.sourceDescription,
    ]).join(" | ");
    existing.sourcePer = unique([existing.sourcePer, row.sourcePer]).join("; ");
    existing.sourceListPrice = "";
  }
  return [...byName.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { numeric: true }),
  );
}

if (!fs.existsSync(SOURCE)) throw new Error(`Missing source workbook: ${SOURCE}`);
const wb = XLSX.readFile(SOURCE);
const sheet = wb.Sheets[wb.SheetNames[0]];
const sourceRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
const skipped = [];
const parts = [];
for (const [index, sourceRow] of sourceRows.entries()) {
  const part = rowToPart(sourceRow);
  if (part.skipped) skipped.push({ index: index + 2, reason: part.skipped, sourceDescription: sourceRow["Prod-Desc"] });
  else parts.push(part);
}
const rows = mergeRows(parts);
const data = {
  sourceSet: {
    name: "IPEX ABS DWV fittings catalogue import",
    status: "ipex-current-price-list-derived",
    notes: [
      "Rows are derived from the official IPEX current June 1 2026 ABS DWV Fittings XLS price list.",
      "Only rows whose Prod-Desc contains ABS are imported; PE/PP accessory rows from the same price list are excluded.",
      "Rows marked Obsolete/No Longer Replenished are excluded from active catalogue import.",
      "Descriptions are clean part labels without material or size.",
      "Hub-only connection text is treated as implied and moved to aliases. Non-hub connection variants remain in labels where they distinguish the part.",
      "San Tee/Santee wording is displayed as TY, matching the XFR organization style, with original source wording preserved in aliases.",
      "Official IPEX P-Code, UPC, universal number, price-list description, and list price are preserved as source evidence.",
      "Images remain blank until a verified ABS-specific image is available; no default placeholder image is assigned.",
    ],
    sourceFiles: [
      {
        kind: "ipexPriceListXls",
        title: "CDN ABS DWV Fittings (XLS) June 1 2026",
        url: "https://ipexna.com/wp-content/uploads/2026/05/CDN-ABS-DWV-Fittings-XLS-June-1-2026.xlsx",
        localPath: "tmp/abs-ipex/CDN-ABS-DWV-Fittings-XLS-June-1-2026.xlsx",
      },
      {
        kind: "ipexSystemBulletinPdf",
        title: "ABS DWV Systems",
        url: "https://ipexna.com/wp-content/uploads/2022/08/bulletin-caen-ipex-abs-dwv.pdf",
        localPath: "",
      },
    ],
    sourceRows: sourceRows.length,
    importedSourceRows: parts.length,
    mergedRows: rows.length,
    skippedRows: skipped,
    generatedAt: new Date().toISOString(),
  },
  imageEvidence: [],
  rows,
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(data, null, 2) + "\n");
console.log(JSON.stringify({
  ok: true,
  source: SOURCE,
  output: OUTPUT,
  sourceRows: sourceRows.length,
  importedSourceRows: parts.length,
  mergedRows: rows.length,
  skippedRows: skipped.length,
}, null, 2));
