#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");

const SOURCE_URL = "https://www.scribd.com/document/345675728/NIBCO-Copper-Fittings-pdf";
const SOURCE_TEXT = path.join(process.cwd(), "tmp/nibco-copper/scribd-preserved.txt");
const OUTPUT = path.join(process.cwd(), "data/catalogue/copper-pressure-catalogue.json");

const CODE_DESCRIPTIONS = {
  "600": "Reducing Coupling C x C Wrot",
  "600-2": "Fitting Reducer Ftg x C Wrot",
  "600-DS": "Coupling with Dimpled Tube Stop C x C Wrot",
  "601": "Coupling without Stop C x C Wrot",
  "603": "Adapter C x F Wrot",
  "603-2": "Fitting Adapter Ftg x F Wrot",
  "604": "Adapter C x M Wrot",
  "604-2": "Fitting Adapter Ftg x M Wrot",
  "604-F": "Flush Adapter C x M Wrot",
  "606": "45 Elbow C x C Wrot",
  "606-2": "45 Fitting Elbow Ftg x C Wrot",
  "607": "90 Elbow Close Rough C x C Wrot",
  "607-2": "90 Fitting Elbow Close Rough Ftg x C Wrot",
  "607-2-2": "90 Fitting Elbow Close Rough Ftg x Ftg Wrot",
  "607-2-LT": "90 Fitting Elbow Long Radius Ftg x C Wrot",
  "607-2-2-LT": "90 Fitting Elbow Long Radius Ftg x Ftg Wrot",
  "607-LT": "90 Elbow Long Radius C x C Wrot",
  "611": "Tee C x C x C Wrot",
  "611-2": "Fitting Tee C x Ftg x C Wrot",
  "611-HE": "Heat Exchanger Tee C x C x C Wrot",
  "616": "Fitted Plug Ftg Wrot",
  "617": "Tube Cap C Wrot",
  "618": "Flush Bushing Ftg x C Wrot",
  "618-3": "Flush Bushing Ftg x F Wrot",
  "619": "Air Chamber Ftg Wrot",
  "621": "Venturi Insert Wrot",
  "623": "Copper Hanger Strap",
  "624": "Tube Strap",
  "633-W": "Union C x C Wrot",
  "638": "Return Bend C x C Wrot",
  "698": "Suction Line P-Trap C x C Wrot",
  "701": "Reducing Coupling C x C Cast",
  "701-D": "Drain Coupling C x C Cast",
  "702": "Eccentric Coupling C x C Cast",
  "703": "Adapter C x F Cast",
  "703-2": "Fitting Adapter Ftg x F Cast",
  "703-5": "Special Drop Adapter C x F Cast",
  "704": "Adapter C x M Cast",
  "704-F": "Flush Adapter C x M Cast",
  "704-H": "Hose Adapter C x Hose Cast",
  "704-2-H": "Hose Adapter Ftg x Hose Cast",
  "705": "Baseboard Tee C x F x C Cast",
  "705-D": "Vent Elbow C x C Cast",
  "706-2": "45 Fitting Elbow Ftg x C Cast",
  "707": "90 Elbow Close Rough C x C Cast",
  "707-2-4": "90 Fitting Elbow C x M Cast",
  "707-3": "90 Elbow C x F Cast",
  "707-3-5": "90 Drop Elbow C x F Cast",
  "707-3-5-A": "90 Hy-Set Elbow C x F Cast",
  "707-3-6": "90 Union Elbow C x F Cast",
  "707-4": "90 Elbow C x M Cast",
  "707-4-6": "90 Union Elbow C x M Cast",
  "707-5": "90 Drop Elbow C x C Cast",
  "707-5-A": "90 Hy-Set Elbow C x C Cast",
  "707-6": "90 Union Elbow C x C Cast",
  "708": "90 Flanged Sink Elbow C x F Cast",
  "710-3": "Tee F x F x C Cast",
  "711": "Tee C x C x C Cast",
  "711-5": "Drop Tee C x C x C Cast",
  "711-A": "Supply and Return Tee C x C x C Cast",
  "712": "Tee C x C x F Cast",
  "712-5": "Drop Tee C x C x F Cast",
  "713": "Tee C x C x M Cast",
  "714": "Tee C x F x C Cast",
  "724-5-A": "Hy-Set Hanger C Cast",
  "733": "Union C x C Cast",
  "733-2": "Fitting Union Ftg x C Cast",
  "733-3": "Fitting Union C x F Cast",
  "733-4": "Union C x M Cast",
  "735": "Cross C x C x C x C Cast",
  "736": "Cross-Over Coupling C x C Cast",
  "739": "Return Bend Closed C x C Cast",
  "741": "Companion Flange C Cast Class 125",
  "748": "90 Y C x C x C Cast",
  "749": "45 Y C x C x C Cast",
  "750": "Bulkhead Fitting C x C Cast",
  "750-3": "Bulkhead Fitting C x F Cast",
  "764": "90 Street Elbow C x Ftg Cast",
  "771": "Companion Flange C Cast Class 150",
  "775": "Companion Flange C Cast Class 300",
};

function normalize(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\u2044/g, "/")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSize(value) {
  return normalize(value)
    .replace(/\s*\/\s*/g, "/")
    .replace(/\s+x\s+/gi, " x ")
    .replace(/\bO\.?\s*D\.?\b/gi, "O.D.")
    .replace(/\bFtg\.?\b/gi, "Ftg")
    .replace(/"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function codeTokens(line) {
  return [...line.matchAll(/\b(?:[67]\d{2})(?:-[A-Z0-9]+)*\b/g)].map((match) => ({
    code: match[0],
    index: match.index,
  }));
}

function isCodeLine(line) {
  const tokens = codeTokens(line);
  if (!tokens.length) return false;
  const compact = line.replace(/\b(?:[67]\d{2})(?:-[A-Z0-9]+)*\b/g, "").replace(/[\s\-\u0007]+/g, "");
  return tokens.length >= 2 || compact.length === 0;
}

function descriptionForSegment(lines, start, end) {
  const pieces = [];
  for (const line of lines) {
    const segment = normalize(line.slice(start, end));
    if (!segment) continue;
    if (/^(APPROX|NOM\.|NET|DIM\.|INCHES|SIZE|LBS\.|NOTE:|CLASS\b)/i.test(segment)) break;
    if (/^[0-9]/.test(segment)) break;
    if (isCodeLine(segment)) continue;
    pieces.push(segment);
    if (pieces.join(" ").length > 70) break;
  }
  return normalize(pieces.join(" "))
    .replace(/\bFtg\.?\b/g, "Ftg")
    .replace(/\bWrot\b/i, "Wrot")
    .replace(/\bCast\b/i, "Cast");
}

function sizeLabel(sizeNominal) {
  return cleanSize(sizeNominal)
    .split(/\s+x\s+/i)
    .map((part) => (/[A-Za-z]/.test(part) ? part : part.replace(/-/g, " ") + '"'))
    .join(" x ");
}

function parseRowsInSegment(lines, start, end) {
  const rows = [];
  for (const line of lines) {
    const segment = normalize(line.slice(start, end));
    if (!segment) continue;
    if (/^(APPROX|NOM\.|NET|DIM\.|INCHES|SIZE|LBS\.|NOTE:|CLASS\b)/i.test(segment)) continue;
    if (/[A-Za-z]/.test(segment) && !/O\.?D\.?|F\s*x|H\b|Roll/i.test(segment) && !/^\d/.test(segment)) {
      continue;
    }
    const match =
      /^(3\/4"?\s+Wide\s+x\s+25\s+Ft\.?\s+Roll|(?:\d+(?:\s+\d+\/\d+|\/\d+)?|(?:\d+\/\d+)|(?:\d+\/\d+\s*O\.?D\.?))(?:\s*(?:x|X)\s*(?:\d+(?:\s+\d+\/\d+|\/\d+)?|(?:\d+\/\d+)|(?:\d+\/\d+\s*O\.?D\.?)|[0-9]+\/[0-9]+\s*[FH])){0,2}(?:\s*[FH])?(?:\s*O\.?D\.?)?)\s+(\d+\.\d+)\b/i.exec(
        segment,
      );
    if (!match) continue;
    const size = cleanSize(match[1]);
    if (!size || /^0\b/.test(size)) continue;
    rows.push(size);
  }
  return rows;
}

function firstSizeNumber(sizeNominal) {
  const first = cleanSize(sizeNominal).split(/\s+x\s+/i)[0].replace(/\b[FMH]\b/gi, "").replace(/\bO\.D\.\b/gi, "").trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(first);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(first);
  return Number.isFinite(number) ? number : null;
}

function uniqueRows(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const key = normalize(row.displayName).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const text = fs.readFileSync(SOURCE_TEXT, "utf8");
const start = text.indexOf("ADAPTERS\n\f\n603");
const end = text.indexOf("Cast Copper Alloy Flared Fittings", start);
if (start < 0 || end < start) throw new Error("Could not find pressure fitting section");

const section = text.slice(start, end);
const lines = section.split(/\n/);
const rows = [];
const skippedBlocks = [];

for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  if (!isCodeLine(line)) continue;
  const tokens = codeTokens(line);
  const starts = tokens.map((token) => token.index);
  const ends = starts.slice(1).concat([Math.max(line.length, 210)]);
  const descLines = lines.slice(i + 1, i + 6);
  let j = i + 1;
  while (j < lines.length && !isCodeLine(lines[j])) j += 1;
  const body = lines.slice(i + 1, j);

  for (let column = 0; column < tokens.length; column += 1) {
    const code = tokens[column].code;
    const columnStart = Math.max(0, starts[column] - 4);
    const columnEnd = ends[column] - 2;
    const parsedDescription = descriptionForSegment(descLines, columnStart, columnEnd);
    const description = CODE_DESCRIPTIONS[code] ?? parsedDescription;
    const sizes = [...new Set(parseRowsInSegment(body, columnStart, columnEnd))].filter((size) => firstSizeNumber(size) != null);
    if (!description || !sizes.length) {
      skippedBlocks.push({ code, description, sizes: sizes.length, line: i + 1 });
      continue;
    }

    const cleanDescription = normalize(description);
    for (const size of sizes) {
      const label = sizeLabel(size);
      rows.push({
        source: "NIBCO Copper Fittings PDF",
        sourceUrl: SOURCE_URL,
        sourceSection: "Wrot and Cast Pressure Fittings",
        sourceCode: code,
        catalog: "Plumbing",
        category: "Fitting",
        material: "Copper",
        sizeNominal: size,
        sizeLabel: label,
        displayName: label + " Copper " + cleanDescription,
        description: cleanDescription,
        imageUrl: "",
        aliases: [
          "NIBCO copper pressure",
          "NIBCO " + code,
          code,
          cleanDescription,
          "Copper " + cleanDescription,
          size + " " + cleanDescription,
        ],
      });
    }
  }
  i = Math.max(i, j - 1);
}

const pipeSizes = ["1/2", "3/4", "1", "1 1/4", "1 1/2", "2", "2 1/2", "3", "4", "5", "6", "8"];
for (const type of ["Type K", "Type L", "Type M"]) {
  for (const size of pipeSizes) {
    rows.push({
      source: "NIBCO Copper Fittings PDF",
      sourceUrl: SOURCE_URL,
      sourceSection: "Copper Water Tube Dimensions",
      sourceCode: "Copper Tube " + type,
      catalog: "Plumbing",
      category: "Pipe",
      material: "Copper",
      sizeNominal: size,
      sizeLabel: size + '"',
      displayName: size + '" Copper Pipe ' + type + " 20 ft",
      description: "Copper Pipe " + type + " 20 ft",
      imageUrl: "",
      aliases: [
        "NIBCO copper pressure",
        "Copper water tube",
        "Copper pipe " + type,
        size + " copper pipe",
        size + " " + type + " copper pipe",
      ],
    });
  }
}

const finalRows = uniqueRows(rows).sort((left, right) =>
  left.displayName.localeCompare(right.displayName, undefined, { numeric: true }),
);

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sourceUrl: SOURCE_URL,
      sourceText: SOURCE_TEXT,
      notes: [
        "Pressure copper fittings were parsed from Scribd's exposed text layer for NIBCO Copper Fittings PDF, pages 6-21.",
        "DWV and flared fitting sections were intentionally excluded.",
        "Pipe rows are generic Type K/L/M copper water tube rows because the referenced NIBCO document is a fittings catalogue, not a pipe SKU catalogue.",
      ],
      rowCount: finalRows.length,
      skippedBlocks,
      rows: finalRows,
    },
    null,
    2,
  ),
);

console.log(JSON.stringify({ rows: finalRows.length, skippedBlocks: skippedBlocks.length, output: OUTPUT }, null, 2));
