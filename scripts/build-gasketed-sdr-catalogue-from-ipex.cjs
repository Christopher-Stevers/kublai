#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");
const pdf = require("../tmp/pdfparse-node/node_modules/pdf-parse");

const SOURCE_URL =
  "https://ipexna.com/wp-content/uploads/2025/04/US-U443PL-033125-IP-Gasketed-Sewer-Fittings-March-31-2025.pdf";
const SOURCE = path.join(
  process.cwd(),
  "tmp/gasketed-sdr/ipex-gasketed-sewer-fittings.pdf",
);
const TEXT_CACHE = path.join(
  process.cwd(),
  "tmp/gasketed-sdr/ipex-gasketed-sewer-fittings.txt",
);
const OUTPUT = path.join(
  process.cwd(),
  "data/catalogue/gasketed-sdr-catalogue.json",
);

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCode(value) {
  return normalize(value).replace(/^\*/, "");
}

function parseSizeNumber(sizeNominal) {
  const first = normalize(sizeNominal)
    .replace(/\s*on\s*/i, " x ")
    .split(/\s*(?:x|×)\s*/i)[0] ?? "";
  const mixed = /^(\d+)\s*[- ]\s*(\d+)\/(\d+)$/.exec(first);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const fraction = /^(\d+)\/(\d+)$/.exec(first);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  const number = Number(first);
  return Number.isFinite(number) ? number : null;
}

function decimalToFraction(num) {
  if (Number.isInteger(num)) return String(num);
  const whole = Math.floor(Math.abs(num));
  const fractional = Math.abs(num) - whole;
  const sixteenths = Math.round(fractional * 16);
  if (sixteenths === 0) return String(num < 0 ? -whole : whole);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  return `${num < 0 ? "-" : ""}${whole > 0 ? `${whole} ` : ""}${sixteenths / divisor}/${16 / divisor}`;
}

function sizeLabel(sizeNominal) {
  return normalize(sizeNominal)
    .replace(/\s*on\s*/i, " on ")
    .split(/\s*(?:x|×)\s*/i)
    .map((part) => {
      const trimmed = part.trim();
      if (/\bon\b/i.test(trimmed)) {
        return trimmed
          .split(/\s+on\s+/i)
          .map((piece) => `${decimalToFraction(parseSizeNumber(piece) ?? Number(piece))}"`)
          .join(" on ");
      }
      const parsed = parseSizeNumber(trimmed);
      return `${parsed == null ? trimmed : decimalToFraction(parsed)}"`;
    })
    .join(" x ");
}

function cleanDescription(value) {
  return normalize(value)
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^TEE\s+G x G x G$/i, "Tee G x G x G")
    .replace(/^1\/8 BEND \(45°\) WYE/i, "45 Wye")
    .replace(/^1\/4 BEND \(90°\)/i, "90")
    .replace(/^1\/8 BEND \(45°\)/i, "45")
    .replace(/^1\/16 BEND \(22-1\/2°\)/i, "22 1/2")
    .replace(/^BEND \(11-1\/4°\)/i, "11 1/4")
    .replace(/\s+,/g, ",")
    .replace(/\s+$/g, "");
}

function materialNameForStandard(standard) {
  if (standard === "SDR35") return "Gasketed DR35";
  if (standard === "SDR26") return "Gasketed DR25";
  throw new Error(`Unsupported gasketed sewer standard: ${standard}`);
}

function isCodeLine(line) {
  return /^\*?\d{3,6}[A-Z0-9-]{2,}$/i.test(normalize(line));
}

function isPriceLine(line) {
  return /^\d{1,3}(?:,\d{3})*\.\d{2}$/.test(normalize(line));
}

function isSizeLine(line) {
  return /^(?:\d{1,2}(?:\s*x\s*\d{1,2}){0,2}|\d{1,2}\s*on\s*\d{1,2})$/i.test(
    normalize(line).replace(/\s+/g, " "),
  );
}

const ignoredHeadings = /^(DESC\.|PRODUCT|CODE|PRICE|CLASS|SKID|Q T Y\.|CTN\.|SIZE|EACH|www\.|Eastern|Western|Tel:|Toll Free|Fax:|Orders|PVC GASKETED|PRICE LIST|\- \d+ \-|\* Fabricated|LARGER SIZE|Discount|Product Description|Multiplier|TABLE OF CONTENTS|SDR35 SEWER FITTINGS|SDR26 HEAVY WALL|Tees|Wyes|Couplings|90|45|22|11)/i;

function isHeadingLine(line) {
  const value = normalize(line);
  if (!value) return false;
  if (ignoredHeadings.test(value)) return false;
  if (isCodeLine(value) || isSizeLine(value) || isPriceLine(value)) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (value.length > 90) return false;
  return true;
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Source PDF not found: ${SOURCE}`);
  }

  let text = fs.existsSync(TEXT_CACHE)
    ? fs.readFileSync(TEXT_CACHE, "utf8")
    : null;
  if (!text) {
    const parsed = await pdf(fs.readFileSync(SOURCE));
    text = parsed.text;
    fs.mkdirSync(path.dirname(TEXT_CACHE), { recursive: true });
    fs.writeFileSync(TEXT_CACHE, text);
  }

  const lines = text.split(/\r?\n/).map(normalize);
  const rows = [];
  let currentStandard = null;
  let currentHeading = null;
  let currentPage = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^- \d+ -$/.test(line)) currentPage = Number(line.replace(/\D/g, ""));
    if (/PVC GASKETED SDR35 SEWER FITTINGS/i.test(line)) {
      currentStandard = "SDR35";
      continue;
    }
    if (/PVC GASKETED SDR26 HEAVY WALL SEWER FITTINGS/i.test(line)) {
      currentStandard = "SDR26";
      continue;
    }
    if (isHeadingLine(line)) {
      currentHeading = line;
      continue;
    }
    if (!currentStandard || !currentHeading || !isCodeLine(line)) continue;

    const size = lines[index + 1];
    const price = lines[index + 2];
    if (!isSizeLine(size) || !isPriceLine(price)) continue;

    const code = normalizeCode(line);
    const material = materialNameForStandard(currentStandard);
    const description = cleanDescription(currentHeading);
    const label = sizeLabel(size);

    rows.push({
      catalog: "Plumbing",
      category: "Fitting",
      material,
      sizeNominal: normalize(size),
      sizeUnit: "in",
      sizeLabel: label,
      displayName: `${label} ${material} ${description}`,
      description,
      imageUrl: "",
      aliases: [
        "IPEX PVC Gasketed Sewer Fittings",
        `IPEX ${currentStandard} Gasketed Sewer Fittings`,
        `PVC Gasketed ${currentStandard} Sewer Fittings`,
        `Gasketed ${currentStandard}`,
        currentHeading,
        code,
      ],
      manufacturerSources: ["ipexGasketedSewerFittingsPriceList2025"],
      supplierParts: [],
      sourceCode: code,
      sourceDescription: currentHeading,
      sourceStandard: currentStandard,
      sourceListPrice: price,
      sourcePage: currentPage,
      sourceUrl: SOURCE_URL,
    });
  }

  const byKey = new Map();
  for (const row of rows) {
    const key = [row.sourceStandard, row.sourceCode, row.sizeNominal].join("|");
    if (byKey.has(key)) {
      throw new Error(`Duplicate source row: ${key}`);
    }
    byKey.set(key, row);
  }

  rows.sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, {
      numeric: true,
    }),
  );

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        source: {
          title: "IPEX PVC Gasketed Sewer Fittings SDR35 & SDR26 Heavy Wall price list",
          url: SOURCE_URL,
          localPath: path.relative(process.cwd(), SOURCE),
          parsedAt: new Date().toISOString(),
        },
        notes: [
          "Rows are parsed from the official IPEX US-U443PL-033125-IP gasketed sewer fittings price list.",
          "Rows are split into Gasketed DR35 and Gasketed DR25 materials; source SDR35/SDR26 text is preserved only in aliases/source metadata.",
          "Descriptions omit SDR/DR material wording so the app-facing label is not duplicated.",
          "Image URLs remain blank until verified part photos are selected.",
        ],
        rows,
      },
      null,
      2,
    ),
  );

  const counts = rows.reduce((acc, row) => {
    acc[row.sourceStandard] = (acc[row.sourceStandard] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ output: OUTPUT, rows: rows.length, counts }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
