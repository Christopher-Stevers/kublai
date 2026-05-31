#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SOURCES = [
  {
    region: "East",
    sourceId: "ipexSystem15FittingsEastPriceList",
    title: "CDN System 15 Ftgs Eastern (XLS) June 1 2026",
    url: "https://ipexna.com/wp-content/uploads/2026/05/CDN-System-15-Ftgs-Eastern-XLS-June-1-2026.xlsx",
    localPath: "tmp/pvc-dwv-ipex/CDN-System-15-Ftgs-Eastern-XLS-June-1-2026.xlsx",
  },
  {
    region: "West",
    sourceId: "ipexSystem15FittingsWestPriceList",
    title: "CDN System 15 Ftgs Western (XLS) June 1 2026",
    url: "https://ipexna.com/wp-content/uploads/2026/05/CDN-System-15-Ftgs-Western-XLS-June-1-2026.xlsx",
    localPath: "tmp/pvc-dwv-ipex/CDN-System-15-Ftgs-Western-XLS-June-1-2026.xlsx",
  },
];
const OUTPUT = path.join(process.cwd(), "data/catalogue/pvc-dwv-catalogue.json");

function normalize(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  const keep = new Set(["PVC", "DWV", "C/O", "SJ", "SP", "H", "FPT", "MPT", "CI", "TY", "LSI", "RSI", "W/", "MJ", "GKT", "SOC"]);
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
    .replace(/ADPT/gi, "Adapter")
    .replace(/ADJ\./gi, "Adjustable")
    .replace(/RED\./gi, "Reducing")
    .replace(/\bRED\b/gi, "Reducing")
    .replace(/\bDBL\b/gi, "Double")
    .replace(/DOUBLEWYE/gi, "Double Wye")
    .replace(/\bY\b/gi, "Wye")
    .replace(/\bFTG\b/gi, "Fitting")
    .replace(/\bELB\b/gi, "Elbow")
    .replace(/\bSYST15\b|\bSYS15\b|\bSYST\. 15\b|\bSYSTEM15\b/gi, "")
    .replace(/SYS\. 15/gi, "")
    .replace(/\bTHR\b/gi, "Threaded");
}

function decimalToFraction(num) {
  if (Number.isInteger(num)) return String(num);
  const whole = Math.floor(Math.abs(num));
  const fractional = Math.abs(num) - whole;
  const sixteenths = Math.round(fractional * 16);
  if (sixteenths === 0) return String(num < 0 ? -whole : whole);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  return (num < 0 ? "-" : "") + (whole > 0 ? whole + "-" : "") + (sixteenths / divisor) + "/" + (16 / divisor);
}

function parseSizeNumber(sizeNominal) {
  const first = normalize(sizeNominal).split(/\s*(?:x|×)\s*/i)[0] || "";
  const mixed = /^(\d+)\s*[- ]\s*(\d+)\/(\d+)$/.exec(first);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const decimal = /^(\d+)\.00$/.exec(first);
  if (decimal) return Number(decimal[1]);
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(first);
  return Number.isFinite(number) ? number : null;
}

function normalizeSizeToken(token) {
  return normalize(token)
    .replace(/[”″"]/g, "")
    .replace(/MM$/i, "")
    .replace(/\.00\b/g, "")
    .replace(/\s*(?:inches|inch|in)\s*$/i, "")
    .trim()
    .replace(/\s+/g, "-");
}

function formatSizeLabel(sizeNominal, sizeUnit = "in") {
  const unit = String(sizeUnit).toLowerCase() === "mm" ? " mm" : "\"";
  return normalize(sizeNominal)
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => {
      const parsed = parseSizeNumber(part);
      return (parsed == null ? part.replace(/mm$/i, "") : decimalToFraction(parsed)) + unit;
    })
    .join(" x ");
}

function sourceSizeLabel(raw, sizeNominal, sizeUnit) {
  if (!(/"/.test(raw) && /MM/i.test(raw))) return formatSizeLabel(sizeNominal, sizeUnit);
  const before = normalize(raw).split(/\bPVC\b|\bDWV\b/i)[0];
  const pieces = before.split(/[xX]/).map((part) => normalize(part)).filter(Boolean);
  if (!pieces.length) return formatSizeLabel(sizeNominal, sizeUnit);
  return pieces
    .map((part) => {
      const token = /(\d+\s+\d\/\d|\d+\/\d|\d+(?:\.00)?)/.exec(part)?.[1];
      if (!token) return "";
      return normalizeSizeToken(token) + (/MM/i.test(part) ? " mm" : "\"");
    })
    .filter(Boolean)
    .join(" x ");
}

function expandConnections(value) {
  return normalize(value)
    .replace(/([A-Z])((?:H|SP|MPT|FPT|SJ|SOC|GKT)x)/gi, "$1 $2")
    .replace(/HXHXGKT/gi, "H x H x GKT")
    .replace(/HXHXHXH/gi, "H x H x H x H")
    .replace(/HXHXHXSP/gi, "H x H x H x SP")
    .replace(/HXHXSP/gi, "H x H x SP")
    .replace(/HXHXH/gi, "H x H x H")
    .replace(/HXH/gi, "H x H")
    .replace(/SPXH/gi, "SP x H")
    .replace(/SPXFPT/gi, "SP x FPT")
    .replace(/HXSJ/gi, "H x SJ")
    .replace(/HXFPT/gi, "H x FPT")
    .replace(/HXMPT/gi, "H x MPT")
    .replace(/HXGKT/gi, "H x GKT")
    .replace(/SOC X SOC X SOC/gi, "H x H x H")
    .replace(/YHXHXH/gi, "WYE H x H x H")
    .replace(/\s+/g, " ");
}

function extractSizesAndAngles(desc) {
  const sizes = [];
  const angles = [];
  const withoutSystem = desc
    .replace(/SYSTEM\s*15/gi, " ")
    .replace(/\bSYST15\b|\bSYS15\b|\bSYST\. 15\b|\bSYSTEM15\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ");
  const withoutAngles = withoutSystem.replace(/(\d+(?:\s+\d\/\d|\.\d+)?)\s*D\b/gi, " ");
  let sizeArea = withoutAngles.split(/\bPVC\b|\bDWV\b/i)[0];
  if (!/\d/.test(sizeArea)) sizeArea = withoutAngles;
  for (const segment of sizeArea.split(/[xX]/)) {
    const match = /(\d+\s+\d\/\d|\d+\/\d|\d+(?:\.00)?)(?:\s*MM)?(?=\s*"?\s*$)/i.exec(normalize(segment));
    if (match) sizes.push(normalizeSizeToken(match[1]));
  }
  for (const match of withoutSystem.matchAll(/(\d+(?:\s+\d\/\d|\.\d+)?)\s*D\b/gi)) {
    angles.push(match[1].replace(/\.5$/, " 1/2").replace(/\.25$/, " 1/4"));
  }
  return { sizes: [...new Set(sizes)], angles: [...new Set(angles)] };
}

function splitRawDescription(raw) {
  const desc = normalize(raw)
    .replace(/SYST15/gi, "SYSTEM 15")
    .replace(/SYS15/gi, "SYSTEM 15")
    .replace(/SYST\. 15/gi, "SYSTEM 15");
  const extracted = extractSizesAndAngles(desc);
  let rest = desc
    .replace(/^SYSTEM 15\s+/i, "")
    .replace(/^DWV\s+SYSTEM 15\s+/i, "")
    .replace(/SYSTEM\s*15/gi, "")
    .replace(/\bSYST15\b|\bSYS15\b|\bSYST\. 15\b|\bSYSTEM15\b/gi, "")
    .replace(/\d+(?:\s+\d\/\d|\.\d+)?\s*D\b/gi, " ")
    .replace(/\bPVC\b/gi, "")
    .replace(/\bDWV\b/gi, "")
    .replace(/\d+(?:\.00)?\s*MM\s*x?/gi, " ")
    .replace(/\d+\s+\d\/\d\s*"?\s*x?/gi, " ")
    .replace(/\d+\/\d\s*"?\s*x?/gi, " ")
    .replace(/\d+(?:\.00)?\s*"?\s*x?/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/\s+/g, " ");
  return { desc, sizes: extracted.sizes, angles: extracted.angles, rest: expandConnections(rest) };
}

function isHubOnly(connection) {
  const c = normalize(connection).replace(/SOC/gi, "H");
  return /^H(?:\s*x\s*H)*(?:\s*x\s*GKT)?$/i.test(c);
}

function cleanLabel(parsed) {
  let label = parsed.rest;
  const connectionMatch = /(\b(?:H|SP|MPT|FPT|SJ|SOC|GKT)\s*x\s*(?:H|SP|SJ|FPT|MPT|GKT|SOC)(?:\s*x\s*(?:H|SP|SJ|FPT|MPT|GKT|SOC))*|\bHUB\b|\bSP\b|\bFPT\b|\bMPT\b)$/i.exec(label);
  const connection = connectionMatch ? normalize(connectionMatch[0]) : "";
  if (connection) label = normalize(label.slice(0, -connection.length));
  label = label
    .replace(/\bSAN TEE\b|\bSANTEE\b/gi, "TY")
    .replace(/\bTEE WYE\b/gi, "Tee Wye")
    .replace(/\bWYE\b|\bDWYE\b/gi, "Wye")
    .replace(/\bDBL\b/gi, "Double")
    .replace(/DOUBLEWYE/gi, "Double Wye")
    .replace(/\bELBOW\b|\bELB\b/gi, "")
    .replace(/\bLONG\b/gi, "Long")
    .replace(/\bSHORT TURN\b/gi, "Short Turn")
    .replace(/SHORT TURNELBOW/gi, "Short Turn")
    .replace(/\bCOUPLING\b/gi, "Coupling")
    .replace(/\bBUSHING\b|\bBUSH\b/gi, "Bushing")
    .replace(/\bADPT\b/gi, "Adapter")
    .replace(/\bFTG C\/O\b/gi, "Fitting C/O")
    .replace(/\bC\/O\b/gi, "C/O")
    .replace(/\bAPARTMENT FTG\b/gi, "Apartment Fitting");
  if (/\bCoupling\b/i.test(label) && parsed.sizes.length > 1 && !/Reduc/i.test(label)) {
    label = label.replace(/\bCoupling\b/i, "Reducing Coupling");
  }
  if (/\bBushing\b/i.test(label) && parsed.sizes.length > 1 && !/Reduc|Flush|Adapter/i.test(label)) {
    label = label.replace(/\bBushing\b/i, "Reducing Bushing");
  }
  label = titleCase(label);
  label = label
    .replace(/Reducing Reducing/gi, "Reducing")
    .replace(/DwvAdapter/gi, "DWV Adapter")
    .replace(/Copto/gi, "COP To")
    .replace(/Tail PieceAdapter/gi, "Tail Piece Adapter")
    .replace(/Spxgskt/gi, "SP x GKT")
    .replace(/Hxswiv/gi, "H x Swivel")
    .replace(/Hx H/gi, "H x H")
    .replace(/SPx H/gi, "SP x H")
    .replace(/H X/gi, "H x")
    .replace(/SP X/gi, "SP x");
  if (parsed.angles.length) {
    const angle = parsed.angles.join(" x ").replace(/22\.5/g, "22 1/2").replace(/11\.25/g, "11 1/4");
    if (!(/\bWye\b/i.test(label) && angle === "45")) {
      label = normalize(angle + " " + label);
    }
  }
  if (connection && !isHubOnly(connection)) label = normalize(label + " " + connection);
  return normalize(label).replace(/\s+Wye\s+Wye\b/i, " Wye");
}

function unique(values) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function rowToPart(row, source) {
  const raw = normalize(row["Prod-Desc"]);
  if (/\bXFR\b|SYSTEM\s*XFR/i.test(raw)) return { skipped: "XFR/System XFR belongs to XFR catalogue" };
  if (/\bPE\b/i.test(raw)) return { skipped: "non-PVC PE accessory row" };
  if (normalize(row["Obsolete/No Longer Replnsh."])) return { skipped: "obsolete/no longer replenished" };
  if (!/\bDWV\b/i.test(raw)) return { skipped: "not DWV" };
  const parsed = splitRawDescription(raw);
  if (!parsed.sizes.length) return { skipped: "could not parse size prefix" };
  const sizeNominal = parsed.sizes.join(" x ");
  const sizeUnit = /MM/i.test(raw) ? "mm" : "in";
  const description = cleanLabel(parsed);
  const sizeLabel = sourceSizeLabel(raw, sizeNominal, sizeUnit);
  const displayName = sizeLabel + " PVC DWV " + description;
  return {
    catalog: "Plumbing",
    category: "Fitting",
    material: "PVC DWV",
    sizeNominal,
    sizeUnit,
    sizeLabel,
    displayName,
    description,
    imageUrl: "",
    aliases: unique([
      "IPEX System 15",
      "System 15",
      "PVC DWV",
      raw,
      "IPEX " + raw,
      row["P-Code"],
      row["UPC-Code"],
      row["Universal Number"],
      source.region,
      parsed.rest,
      parsed.angles.length ? parsed.angles.join(" x ") + " " + description : "",
    ]),
    manufacturerSources: [source.sourceId],
    supplierParts: [],
    sourcePCode: normalize(row["P-Code"]),
    sourceUpc: normalize(row["UPC-Code"]),
    sourceUniversalNumber: normalize(row["Universal Number"]),
    sourceDescription: raw,
    sourcePer: normalize(row["/Per"]),
    sourceListPrice: normalize(row[" List Price "]),
    sourceRegions: [source.region],
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
    existing.aliases = unique([...(existing.aliases || []), ...(row.aliases || []), row.displayName, row.description]);
    existing.manufacturerSources = unique([...(existing.manufacturerSources || []), ...(row.manufacturerSources || [])]);
    existing.sourceRegions = unique([...(existing.sourceRegions || []), ...(row.sourceRegions || [])]);
    existing.sourcePCode = unique([existing.sourcePCode, row.sourcePCode]).join("; ");
    existing.sourceUpc = unique([existing.sourceUpc, row.sourceUpc]).join("; ");
    existing.sourceUniversalNumber = unique([existing.sourceUniversalNumber, row.sourceUniversalNumber]).join("; ");
    existing.sourceDescription = unique([existing.sourceDescription, row.sourceDescription]).join(" | ");
    existing.sourcePer = unique([existing.sourcePer, row.sourcePer]).join("; ");
    existing.sourceListPrice = "";
  }
  return [...byName.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { numeric: true }));
}

const skipped = [];
const parts = [];
let sourceRows = 0;
for (const source of SOURCES) {
  const fullPath = path.join(process.cwd(), source.localPath);
  if (!fs.existsSync(fullPath)) throw new Error("Missing source workbook: " + fullPath);
  const wb = XLSX.readFile(fullPath);
  const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
  sourceRows += sheetRows.length;
  for (const [index, sourceRow] of sheetRows.entries()) {
    const part = rowToPart(sourceRow, source);
    if (part.skipped) skipped.push({ source: source.region, index: index + 2, reason: part.skipped, sourceDescription: sourceRow["Prod-Desc"] });
    else parts.push(part);
  }
}
const rows = mergeRows(parts);
const data = {
  sourceSet: {
    name: "IPEX PVC DWV System 15 fittings catalogue import",
    status: "ipex-current-price-list-derived",
    notes: [
      "Rows are derived from official IPEX current June 1 2026 System 15 Fittings East and West XLS price lists.",
      "System XFR/XFR rows are excluded because XFR is maintained as a separate product catalogue.",
      "PE accessory rows and obsolete/no-longer-replenished rows are excluded from active catalogue import.",
      "East/West duplicate fitting rows are merged into one app part with both region source records preserved.",
      "Descriptions are clean labels without material or size.",
      "Hub-only connection text is treated as implied and moved to aliases. Non-hub connection variants remain in labels where they distinguish the part.",
      "Images remain blank until a verified PVC DWV-specific image is available; no default placeholder image is assigned.",
    ],
    sourceFiles: SOURCES,
    sourceRows,
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
console.log(JSON.stringify({ ok: true, output: OUTPUT, sourceRows, importedSourceRows: parts.length, mergedRows: rows.length, skippedRows: skipped.length }, null, 2));
