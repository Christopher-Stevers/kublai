#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");
const pdf = require("../tmp/pdfparse-node/node_modules/pdf-parse");

const SOURCE_URL =
  "https://bibby-ste-croix.com/upl/downloads/catalog/products/cast-iron-soil-pipe-and-fittings-for-drain-waste-vent-315c16a1.pdf";
const SOURCE = path.join(
  process.cwd(),
  "tmp/cast-bibby/cast-iron-soil-pipe-and-fittings-for-drain-waste-vent.pdf",
);
const OUTPUT = path.join(process.cwd(), "data/catalogue/cast-catalogue.json");

const MM_TO_IN = new Map([
  ["38", "1-1/2"],
  ["50", "2"],
  ["75", "3"],
  ["100", "4"],
  ["125", "5"],
  ["150", "6"],
  ["200", "8"],
  ["250", "10"],
  ["300", "12"],
  ["375", "15"],
]);
const MM_VALUES = [...MM_TO_IN.keys()].sort((a, b) => b.length - a.length);
const FITTING_PAGE_MIN = 45;
const FITTING_PAGE_MAX = 82;

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\u0000/g, " ")
    .replace(/\r/g, "")
    .replace(/\u2044/g, "/")
    .replace(/[“”]/g, '"')
    .replace(/[×x]/g, " x ");
}

function sizeLabel(sizeNominal) {
  return normalize(sizeNominal)
    .split(/\s*x\s*/i)
    .map((part) => `${part.replace(/-/g, " ")}"`)
    .join(" x ");
}

function pageSections(text) {
  const pieces = text.split(/65471_Grand_Cat_Int[^\n]*Page(\d+)/);
  const sections = [];
  for (let index = 1; index < pieces.length; index += 2) {
    const printedPage = Number(pieces[index]);
    if (printedPage >= FITTING_PAGE_MIN && printedPage <= FITTING_PAGE_MAX) {
      sections.push({ printedPage, body: pieces[index + 1] ?? "" });
    }
  }
  return sections;
}

function stitchCodes(text) {
  return text
    .replace(/\b([sn])\s*\n\s*(\d)\s*\n\s*(\d{4})(\*{0,2})\b/gi, "$1$2$3$4")
    .replace(/\b([sn])\s*\n\s*(\d{5})(\*{0,2})\b/gi, "$1$2$3")
    .replace(/\bss(\d{5})\b/gi, "s$1")
    .replace(/\bi\s*\n\s*n\./gi, "in.")
    .replace(/\bm\s*\n\s*m/gi, "mm");
}

function isHeadingLine(line) {
  const value = normalize(line);
  if (!value) return false;
  if (/^[A-Z]$/.test(value)) return false;
  if (/^(PF-|BIBBY|WWW\.|Code|Size|Weight|Qty|Per Bundle|in\.|mm\b|Note:|\*|Cover$|Only$|A$|B$|C$|D$|R$|J$|T$)/i.test(value)) {
    return false;
  }
  if (/^[sn]\s*\d{5}/i.test(value)) return false;
  if (/\b(lb\.|kg)\b/i.test(value)) return false;
  if (!/[A-Za-z"°]/.test(value)) return false;
  return true;
}

function cleanHeading(value) {
  let heading = normalize(value)
    .replace(/\s*–\s*/g, " - ")
    .replace(/\b1\s*\/\s*4\b/g, "1/4")
    .replace(/\b1\s*\/\s*8\b/g, "1/8")
    .replace(/\b1\s*\/\s*6\b/g, "1/6")
    .replace(/\b1\s*\/\s*16\b/g, "1/16")
    .replace(/22\s*1\s*\/\s*2/g, "22 1/2")
    .replace(/\s+/g, " ");
  heading = heading
    .replace(/^D\s*ouble/i, "Double")
    .replace(/^B\s*ends/i, "Bends")
    .replace(/^R\s*oof/i, "Roof")
    .replace(/^TY"/i, '"TY"')
    .replace(/^ouble/i, "Double");
  return normalize(heading);
}

function headingFromGap(gap, fallback) {
  const normalizedGap = normalize(gap)
    .replace(/1\s*\/\s*4/g, "1/4")
    .replace(/1\s*\/\s*8/g, "1/8")
    .replace(/1\s*\/\s*6/g, "1/6")
    .replace(/1\s*\/\s*16/g, "1/16")
    .replace(/22\s*1\s*\/\s*2/g, "22 1/2");
  const hasNewSection =
    /Code\s*Size|C\s+ode\s+S\s+ize/i.test(normalizedGap) ||
    /B\s+ends|Bends?|Increasers|Reducers|Traps?|Running|Wye|TY|Apartment|Plugs?|Urinal|Flange|Cleanouts?|Valves?|Grates?|Catchbasin|Roof/i.test(
      normalizedGap,
    );
  if (!hasNewSection) return fallback;
  const directBendMatch = /(?:B\s+ends|Bends?|ends)\s*[-–]\s*(?:1\s*)?\/\s*(?:4|8|6|16)\s*[-–]?\s*[^C]*?(?:Short Turn|Long Pattern|$)/i.exec(
    normalizedGap,
  );
  if (directBendMatch) return cleanHeading(directBendMatch[0]);
  const lines = gap
    .split(/\n/)
    .map((line) => normalize(line))
    .filter(isHeadingLine)
    .map(cleanHeading)
    .filter(Boolean);
  if (!lines.length) return fallback;
  const codeHeaderIndex = lines.findIndex((line) => /Code\s*Size/i.test(line));
  const candidates = codeHeaderIndex >= 0 ? lines.slice(0, codeHeaderIndex) : lines;
  const useful = candidates.filter(
    (line) =>
      !/^(H|U|B|L|E|S|S|M|J|P|I|G|O|T|Notes:)$/i.test(line) &&
      !/^Hubless Fittings/i.test(line),
  );
  const joined = useful.join(" ");
  const sectionMatch =
    /(Extended\s+)?(Quarter\s+)?(?:B\s+ends|Bends?|ends)\s*[-–]\s*(?:1\s*)?\/\s*(?:4|8|6|16)[^C]*|Increasers\s*\/\s*Reducers(?:\s*[-–]\s*Tapped)?|Swivel\s+"P"\s+Traps|"P"\s+Traps[^C]*|Running\s+Traps[^C]*|"?Y"?\s*(?:\(continued\))?|TY"?[^C]*|Upright\s+"Y"[^C]*|Double\s+Combination\s+"Y"[^C]*|Combination\s+"Y"[^C]*|Double\s+"TY"[^C]*|Double\s+"Y"[^C]*|Double\s+Apartment\s+Fittings[^C]*|Single\s+Apartment\s+Fittings[^C]*|Plugs?[^C]*|Urinal\s+Fittings|Floor\s+Flange[^C]*|Closet\s+Flange[^C]*|Malcolm[^C]*|Iron\s+Body\s+Cleanouts?[^C]*|Line\s+Cleanouts?[^C]*|Back\s+Water\s+Valves[^C]*|Barrett\s+Cleanouts?[^C]*|Roof\s+Increasers[^C]*|Reducers?|Grates?[^C]*|Catchbasin\s+Ring\s+and\s+Cover/i.exec(
      joined,
    );
  return sectionMatch ? cleanHeading(sectionMatch[0]) : useful.length ? useful.slice(-2).join(" ") : fallback;
}

function normalizeHeadingForDescription(heading, system) {
  let description = normalize(heading)
    .replace(/\bHubless \(MJ\)\b/gi, "")
    .replace(/\bHub & Spigot\b/gi, "")
    .replace(/\bMJ\b/g, "MJ")
    .replace(/\bCodeSize\w*\b/gi, "")
    .replace(/\s+/g, " ");
  description = description
    .replace(/Bends?\s*-\s*(?:1)?\/4\s*-\s*90°/i, "90° Bend")
    .replace(/Bends?\s*-\s*(?:1)?\/8\s*-\s*45°/i, "45° Bend")
    .replace(/Bends?\s*-\s*(?:1)?\/6\s*-\s*60°/i, "60° Bend")
    .replace(/Bends?\s*-\s*(?:1)?\/16\s*-\s*22\s*1\/2°/i, "22 1/2° Bend")
    .replace(/Bends?\s*-\s*\/2°/i, "22 1/2° Bend")
    .replace(/Increasers\s*\/\s*Reducers\s*-\s*Tapped/i, "Tapped Increaser/Reducer")
    .replace(/Increasers\s*\/\s*Reducers/i, "Increaser/Reducer")
    .replace(/"Y"/g, "Wye")
    .replace(/"TY"/g, "TY")
    .replace(/\bTY"\b/g, "TY")
    .replace(/\s+/g, " ");
  if (/Short Turn/i.test(heading) && !/Short Turn/i.test(description)) description += " Short Turn";
  if (/Long Pattern/i.test(heading) && !/Long Pattern/i.test(description)) description += " Long Pattern";
  if (/Single Hub/i.test(system) && !/Single Hub/i.test(description)) description += " Single Hub";
  description = normalize(description)
    .replace(/^(?:B\s+ends|ends)\s*-\s*(?:1)?\/8\s*-\s*45°/i, "45° Bend")
    .replace(/\bode\s+ize\w*/gi, "")
    .replace(/\(continued\)/gi, "")
    .replace(/\/8\s*Bend/gi, "1/8 Bend")
    .replace(/\/2\s*̋/gi, "1/2\"")
    .replace(/^\/226\.5 lb\.\s*/i, "")
    .replace(/^\/42\.8 lb\.\s*/i, "")
    .replace(/^\/465\.0 lb\.\s*/i, "")
    .replace(/^\/84\*70\.0 lb\.\s*/i, "")
    .replace(/^\/885\.4 lb\.\s*/i, "")
    .replace(/^TY\s+Redu$/i, "TY Reducing 45° Tapped")
    .replace(/^Double\s+TY\s+\($/i, "Double TY (Cross)")
    .replace(/^Double\s+TY\s+-\s+Tapped\s+\($/i, "Double TY Tapped (Cross)")
    .replace(/^Double\s+Apartment\s+Fittings\s+\($/i, "Double Apartment Fitting (Cross)")
    .replace(/^Back\s+Water\s+Valves\s+-$/i, "Back Water Valve")
    .replace(/^Back\s+Water\s+Valves\s+-\s+Hubless \(MJ\)$/i, "Hubless Back Water Valve")
    .replace(/^Barrett\s+Cleanouts\s+-$/i, "Barrett Cleanout")
    .replace(/^Malcolm\s+-\s+End$/i, "Malcolm End Cleanout")
    .replace(/^Malcolm\s+-\s+Anthes$/i, "Malcolm Anthes Cleanout")
    .replace(/^Plugs\s+-$/i, "Plug")
    .replace(/^Plugs\s+-\s+Hubless \(MJ\)$/i, "Hubless Plug")
    .replace(/^Closet\s+Flange\s+\(Slot\s+&\s+Not$/i, "Closet Flange (Slot & Notch)")
    .replace(/^Floor\s+Flanges/i, "Floor Flange")
    .replace(/^Reducers$/i, "Reducer")
    .replace(/^Bell\s+Traps$/i, "Bell Trap")
    .replace(/^Trap\s+Seal\s+Primer\s+Connection$/i, "Trap Seal Primer Connection")
    .replace(/^Flange \(for Closet Bend\) - Caulking$/i, "Flange for Closet Bend - Caulking")
    .replace(/E\s+x\s+tended/gi, "Extended")
    .replace(/\bw\s+\/\s+/gi, "w/ ")
    .replace(/^Iron Body Cleanouts Brass Plug \(MJ\) R$/i, "MJ Iron Body Cleanout Brass Plug")
    .replace(/\s+/g, " ");
  return normalize(description);
}

function extractMmSizes(block) {
  const match = /\bmm\s*([\s\S]*?)\bkg\b/i.exec(block);
  if (!match) return [];
  let value = normalize(match[1]).replace(/\s*x\s*/gi, " x ");
  const sizes = [];
  if (value.includes(" x ")) {
    for (const part of value.split(/\s*x\s*/)) {
      const found = MM_VALUES.find((mm) => part.startsWith(mm));
      if (found) sizes.push(found);
    }
  } else {
    const found = MM_VALUES.find((mm) => value.startsWith(mm));
    if (found) sizes.push(found);
  }
  return sizes;
}

function unique(values) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function rowKey(row) {
  return [row.displayName, row.sourceCode].map(normalize).join("|").toLowerCase();
}

async function extractPdfText() {
  const data = fs.readFileSync(SOURCE);
  const parsed = await pdf(data);
  return normalizeText(parsed.text);
}

async function main() {
  if (!fs.existsSync(SOURCE)) {
    throw new Error(`Missing source PDF: ${SOURCE}`);
  }
  const text = stitchCodes(await extractPdfText());
  const rows = [];
  const skipped = [];

  for (const section of pageSections(text)) {
    if (section.printedPage === 70 || section.printedPage === 83) continue;
    let currentHeading = "";
    const body = section.body;
    const codePattern = /\b([sn])\s*(\d{5})(\*{0,2})\b/g;
    const matches = [...body.matchAll(codePattern)];
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const start = match.index ?? 0;
      const end = index + 1 < matches.length ? matches[index + 1].index ?? body.length : body.length;
      const gapStart = index === 0 ? 0 : (matches[index - 1].index ?? 0) + matches[index - 1][0].length;
      currentHeading = headingFromGap(body.slice(gapStart, start), currentHeading);
      const sourceCode = `${match[1].toLowerCase()}${match[2]}`;
      const block = body.slice(start, end);
      const mmSizes = extractMmSizes(block);
      if (!currentHeading) {
        skipped.push({ sourceCode, printedPage: section.printedPage, reason: "missing heading" });
        continue;
      }
      if (!mmSizes.length) {
        skipped.push({ sourceCode, printedPage: section.printedPage, reason: "missing metric size" });
        continue;
      }
      const sizeNominal = mmSizes.map((mm) => MM_TO_IN.get(mm)).filter(Boolean).join(" x ");
      if (!sizeNominal) {
        skipped.push({ sourceCode, printedPage: section.printedPage, reason: "unmapped size" });
        continue;
      }
      const system = section.printedPage >= 71 ? "Hub & Spigot" : "MJ";
      const baseDescription = normalizeHeadingForDescription(currentHeading, system);
      const description = normalize(
        baseDescription.toLowerCase().startsWith(system.toLowerCase())
          ? baseDescription
          : `${system} ${baseDescription}`,
      )
        .replace(/\bMJ\s+Hubless\b/i, "MJ")
        .replace(/\bMJ\s+MJ\b/i, "MJ")
        .replace(/\bMJ\s+TY\s+MJ\b/i, "MJ TY");
      if (!description || /Pipe/i.test(description)) continue;
      rows.push({
        catalog: "Plumbing",
        category: "Fitting",
        material: "Cast",
        sizeNominal,
        sizeUnit: "in",
        sizeLabel: sizeLabel(sizeNominal),
        displayName: `${sizeLabel(sizeNominal)} Cast ${description}`,
        description,
        imageUrl: "",
        aliases: unique([
          "Bibby-Ste-Croix cast iron",
          "Bibby cast iron",
          "Cast Iron Soil Pipe and Fittings",
          system,
          currentHeading,
          sourceCode,
          `Bibby ${sourceCode}`,
          `Bibby ${sizeLabel(sizeNominal)} ${description}`,
        ]),
        manufacturerSources: ["bibbySteCroixCastIronSoilPipeAndFittingsDwv"],
        supplierParts: [],
        sourceCode,
        sourcePage: section.printedPage,
        sourceSystem: system,
        sourceUrl: SOURCE_URL,
      });
    }
  }

  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }

  const displayCounts = new Map();
  for (const row of deduped) {
    const key = normalize(row.displayName).toLowerCase();
    displayCounts.set(key, (displayCounts.get(key) ?? 0) + 1);
  }
  for (const row of deduped) {
    const key = normalize(row.displayName).toLowerCase();
    if ((displayCounts.get(key) ?? 0) > 1) {
      const originalDisplayName = row.displayName;
      row.displayName = `${originalDisplayName} Bibby ${row.sourceCode.toUpperCase()}`;
      row.aliases = unique([...(row.aliases ?? []), originalDisplayName]);
    }
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      {
        source: {
          url: SOURCE_URL,
          localPath: path.relative(process.cwd(), SOURCE),
          parsedAt: new Date().toISOString(),
        },
        importedRows: deduped.length,
        skipped,
        rows: deduped,
      },
      null,
      2,
    ),
  );

  const byDescription = new Map();
  for (const row of deduped) {
    byDescription.set(row.description, (byDescription.get(row.description) ?? 0) + 1);
  }
  console.log(
    JSON.stringify(
      {
        output: OUTPUT,
        rows: deduped.length,
        skipped: skipped.length,
        descriptions: [...byDescription.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
