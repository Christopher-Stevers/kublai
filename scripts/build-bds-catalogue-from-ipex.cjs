#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");

const SOURCE_URL =
  "https://ipexna.com/wp-content/uploads/2023/05/catalogue-caen-ipex-modern-niagara-pvc-bds.pdf";
const OUTPUT = path.join(process.cwd(), "data/catalogue/bds-catalogue.json");

function normalize(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function parseSizeParts(size) {
  return normalize(size)
    .replace(/1-1\/2/g, "1 1/2")
    .split(/\s*x\s*/i)
    .map((part) => normalize(part));
}

function sizeLabel(size) {
  return parseSizeParts(size)
    .map((part) => `${part}"`)
    .join(" x ");
}

function firstSize(size) {
  return parseSizeParts(size)[0];
}

function isReducing(size) {
  const parts = parseSizeParts(size);
  return parts.length > 1 && new Set(parts).size > 1;
}

function cleanLabel(section, size, color) {
  const hasSp = /\bSp x H\b/i.test(section);
  const hasShortRadius = /Short Radius/i.test(section);
  let label = section
    .replace(/\s+/g, " ")
    .replace(/\s*\(1\/4 Bend\)/i, "")
    .replace(/\s*\(1\/8 Bend\)/i, "")
    .replace(/\s*\(1\/16 Bend\)/i, "")
    .replace(/\s*\(pp\)/i, "")
    .replace(/\s+H x H x H x H$/i, "")
    .replace(/\s+H x H x H$/i, "")
    .replace(/\s+Sp x H x H$/i, "")
    .replace(/\s+H x H$/i, "")
    .replace(/\s+Sp x H$/i, "")
    .replace(/\s+H$/i, "")
    .replace(/\s+MPT$/i, " Male")
    .replace(/\s+Sp$/i, "")
    .replace(/\s+H x FPT$/i, "")
    .replace(/\s+Sp x FIP Thread$/i, " Sp x FIP Thread")
    .replace(/\s+Sp x FIP Threads$/i, " Sp x FIP Threads")
    .replace(/\s+H x FIP Threads$/i, " H x FIP Threads")
    .replace(/\s+H x MPT$/i, " H x MPT")
    .replace(/\s+Sp x G$/i, " Sp x G")
    .trim();

  if (/^45° Wye/i.test(label)) label = hasSp ? "Fitting Wye" : "Wye";
  if (/^90° Elbow/i.test(label)) label = isReducing(size) ? "Reducing 90" : hasSp ? "Fitting 90" : "90";
  if (/^45° Elbow/i.test(label)) label = hasSp ? "Fitting 45" : "45";
  if (/^22-1\/2° Elbow/i.test(label)) label = hasSp ? "Fitting 22-1/2°" : "22-1/2°";
  if (hasShortRadius) label += " Short Radius";
  if (/^Cross/i.test(label)) label = "Cross";
  if (/^Coupling with Pipe Stop/i.test(label)) label = isReducing(size) ? "Reducing Coupling" : "Coupling";
  if (/^Reducer Coupling with Pipe Stop/i.test(label)) label = "Reducing Coupling";
  if (/^Reducer Bushing Sp x H/i.test(label)) label = "Bushing";
  if (/^P Trap/i.test(label)) label = "P-Trap";
  if (/^Cap/i.test(label)) label = "Cap";
  if (/^Cleanout Plug/i.test(label)) label = "Cleanout Plug Male";
  if (/^Closet Flange/i.test(label)) label = "Closet Flange";
  if (/^Floor Drain Grate/i.test(label)) label = "Floor Drain Grate";
  if (/^Floor Grate/i.test(label)) label = `Floor Grate${color ? ` ${color}` : ""}`;
  if (/^Grates/i.test(label)) label = "Grate";
  if (/^Plugs \/ Covers/i.test(label)) label = "Plugs / Covers";
  if (/^Straight Tee/i.test(label) && hasSp) label = "Straight Tee Sp x H x H";
  if (/^Sanitary Tee/i.test(label) && hasSp) label = "Sanitary Tee Sp x H x H";
  if (/^BDS Solvent Weld Sewer Pipe - Solid/i.test(label)) label = `Pipe SDR35${color ? ` ${color}` : ""}`;
  if (/^BDS Solvent Weld Sewer Pipe - Perforated/i.test(label)) label = `Perforated Pipe SDR35${color ? ` ${color}` : ""}`;
  return normalize(label);
}

function row(section, size, mm, code, page, options = {}) {
  const category = options.category ?? "Fitting";
  const label = cleanLabel(section, size, options.color);
  const sizeText = sizeLabel(size);
  return {
    catalog: "Plumbing",
    category,
    material: "BDS",
    sizeNominal: normalize(size).replace(/1-1\/2/g, "1.5"),
    sizeUnit: "in",
    sizeLabel: sizeText,
    displayName: `${sizeText} BDS ${label}`,
    description: "",
    imageUrl: "",
    aliases: [
      section,
      options.color,
      mm ? `${mm} mm` : "",
      `IPEX Product Code ${code}`,
      code,
    ].filter(Boolean),
    manufacturerSources: ["ipexModernNiagaraPvcBdsCatalogue2023"],
    supplierParts: [],
    sourceCode: code,
    sourcePage: page,
    sourceUrl: SOURCE_URL,
  };
}

const rows = [
  row("BDS Solvent Weld Sewer Pipe - Solid (10 ft lengths)", "3", "75", "003530", 36, { category: "Pipe" }),
  row("BDS Solvent Weld Sewer Pipe - Solid (10 ft lengths)", "4", "100", "003644", 36, { category: "Pipe", color: "White" }),
  row("BDS Solvent Weld Sewer Pipe - Solid (10 ft lengths)", "4", "100", "003645", 36, { category: "Pipe", color: "Green" }),
  row("BDS Solvent Weld Sewer Pipe - Solid (10 ft lengths)", "6", "150", "003560", 36, { category: "Pipe", color: "White" }),
  row("BDS Solvent Weld Sewer Pipe - Solid (10 ft lengths)", "6", "150", "003561", 36, { category: "Pipe", color: "Green" }),
  row("BDS Solvent Weld Sewer Pipe - Perforated (10 ft lengths)", "3", "75", "004530", 36, { category: "Pipe" }),
  row("BDS Solvent Weld Sewer Pipe - Perforated (10 ft lengths)", "4", "100", "004140", 36, { category: "Pipe" }),
  row("BDS Solvent Weld Sewer Pipe - Perforated (10 ft lengths)", "6", "150", "004565", 36, { category: "Pipe" }),
  row("Straight Tee H x H x H", "3 x 3 x 3", "75 x 75 x 75", "040102", 36),
  row("Straight Tee H x H x H", "4 x 4 x 3", "100 x 100 x 75", "040109", 36),
  row("Straight Tee H x H x H", "4 x 4 x 4", "100 x 100 x 100", "040104", 36),
  row("Straight Tee H x H x H", "6 x 6 x 4", "150 x 150 x 100", "040105", 36),
  row("Straight Tee H x H x H", "6 x 6 x 6", "150 x 150 x 150", "040106", 36),
  row("Straight Tee H x H x H", "8 x 8 x 4", "200 x 200 x 100", "040117", 36),
  row("Straight Tee H x H x H", "8 x 8 x 6", "200 x 200 x 150", "040118", 36),
  row("Straight Tee H x H x H", "8 x 8 x 8", "200 x 200 x 200", "040108", 36),
  row("Straight Tee Sp x H x H", "4 x 4 x 4", "100 x 100 x 100", "040114", 36),
  row("Cleanout Tee H x H x FPT", "4", "100", "040922", 36),
  row("2 Way Cleanout H x H x H", "4 x 4 x 4", "100 x 100 x 100", "040350", 36),
  row("Sanitary Tee H x H x H", "3 x 3 x 3", "75 x 75 x 75", "040155", 36),
  row("Sanitary Tee H x H x H", "4 x 4 x 4", "100 x 100 x 100", "040156", 36),
  row("Sanitary Tee H x H x H", "6 x 6 x 4", "150 x 150 x 100", "040158", 36),
  row("Sanitary Tee H x H x H", "6 x 6 x 6", "150 x 150 x 150", "040159", 36),
  row("Sanitary Tee Sp x H x H", "4 x 4 x 4", "100 x 100 x 100", "040157", 36),
  row("45° Wye H x H x H", "3 x 3 x 2", "75 x 75 x 50", "040303", 36),
  row("45° Wye H x H x H", "3 x 3 x 3", "75 x 75 x 75", "040302", 36),
  row("45° Wye H x H x H", "4 x 4 x 2", "100 x 100 x 50", "040308", 36),
  row("45° Wye H x H x H", "4 x 4 x 3", "100 x 100 x 75", "040309", 36),
  row("45° Wye H x H x H", "4 x 4 x 4", "100 x 100 x 100", "040304", 36),
  row("45° Wye H x H x H", "6 x 6 x 4", "150 x 150 x 100", "040307", 36),
  row("45° Wye H x H x H", "6 x 6 x 6", "150 x 150 x 150", "040306", 36),
  row("45° Wye H x H x H", "8 x 8 x 4", "200 x 200 x 100", "040310", 36),
  row("45° Wye H x H x H", "8 x 8 x 6", "200 x 200 x 150", "040312", 36),
  row("45° Wye H x H x H", "8 x 8 x 8", "200 x 200 x 200", "040311", 36),
  row("45° Wye H x H x H", "10 x 10 x 10", "250 x 250 x 250", "040313", 36),
  row("45° Wye H x H x H", "12 x 12 x 12", "300 x 300 x 300", "040314", 36),
  row("45° Wye Sp x H x H", "3 x 3 x 3", "75 x 75 x 75", "040332", 36),
  row("45° Wye Sp x H x H", "4 x 4 x 4", "100 x 100 x 100", "040334", 36),
  row("45° Wye Sp x H x H", "6 x 6 x 6", "150 x 150 x 150", "040338", 36),
  row("Cross H x H x H x H", "3", "75", "040975", 36),
  row("Cross H x H x H x H", "4", "100", "040976", 36),
  row("90° Elbow (1/4 Bend) H x H", "2", "50", "040254", 36),
  row("90° Elbow (1/4 Bend) H x H", "3", "75", "040255", 36),
  row("90° Elbow (1/4 Bend) H x H", "4", "100", "040214", 36),
  row("90° Elbow (1/4 Bend) H x H", "4 x 3", "100 x 75", "040259", 36),
  row("90° Elbow (1/4 Bend) H x H", "6", "150", "040206", 36),
  row("90° Elbow (1/4 Bend) H x H", "8", "200", "040208", 36),
  row("90° Elbow (1/4 Bend) H x H Short Radius (BNQ ONLY)", "4", "100", "040256", 36),
  row("90° Elbow (1/4 Bend) Sp x H", "2", "50", "040270", 36),
  row("90° Elbow (1/4 Bend) Sp x H", "3", "75", "040272", 36),
  row("90° Elbow (1/4 Bend) Sp x H", "4", "100", "040234", 36),
  row("90° Elbow (1/4 Bend) Sp x H", "6", "150", "040236", 36),
  row("90° Elbow (1/4 Bend) Sp x H Short Radius (BNQ ONLY)", "4", "100", "040274", 36),
  row("45° Elbow (1/8 Bend) H x H", "2", "50", "040500", 37),
  row("45° Elbow (1/8 Bend) H x H", "3", "75", "040502", 37),
  row("45° Elbow (1/8 Bend) H x H", "4", "100", "040504", 37),
  row("45° Elbow (1/8 Bend) H x H", "6", "150", "040506", 37),
  row("45° Elbow (1/8 Bend) H x H", "8", "200", "040508", 37),
  row("45° Elbow (1/8 Bend) H x H", "10", "250", "040407", 37),
  row("45° Elbow (1/8 Bend) Sp x H", "2", "50", "040400", 37),
  row("45° Elbow (1/8 Bend) Sp x H", "3", "75", "040402", 37),
  row("45° Elbow (1/8 Bend) Sp x H", "4", "100", "040404", 37),
  row("45° Elbow (1/8 Bend) Sp x H", "6", "150", "040406", 37),
  row("45° Elbow (1/8 Bend) Sp x H", "8", "200", "040408", 37),
  row("22-1/2° Elbow (1/16 Bend) H x H", "3", "75", "040963", 37),
  row("22-1/2° Elbow (1/16 Bend) H x H", "4", "100", "040964", 37),
  row("22-1/2° Elbow (1/16 Bend) H x H", "6", "150", "040969", 37),
  row("22-1/2° Elbow (1/16 Bend) Sp x H", "4", "100", "040864", 37),
  row("22-1/2° Elbow (1/16 Bend) Sp x H", "6", "150", "040866", 37),
  row("P Trap H x H", "2", "50", "040978", 37),
  row("P Trap H x H", "3", "75", "040979", 37),
  row("P Trap H x H", "4", "100", "040980", 37),
  row("Coupling with Pipe Stop H x H", "2", "50", "040600", 37),
  row("Coupling with Pipe Stop H x H", "3", "75", "040602", 37),
  row("Coupling with Pipe Stop H x H", "4", "100", "040604", 37),
  row("Coupling with Pipe Stop H x H", "6", "150", "040606", 37),
  row("Coupling with Pipe Stop H x H", "8", "200", "040631", 37),
  row("Repair Coupling without Pipe Stop H x H", "4", "100", "040624", 37),
  row("Repair Coupling without Pipe Stop H x H", "6", "150", "040626", 37),
  row("Reducer Coupling with Pipe Stop H x H", "4 x 2", "100 x 50", "040656", 37),
  row("Reducer Coupling with Pipe Stop H x H", "4 x 3", "100 x 75", "040654", 37),
  row("Reducer Coupling with Pipe Stop H x H", "6 x 4", "150 x 100", "040661", 37),
  row("Cap H", "3", "75", "040986", 37),
  row("Cap H", "4", "100", "040959", 37),
  row("Cap H", "6", "150", "040988", 37),
  row("Cap H", "8", "200", "040990", 37),
  row("Cleanout Plug MPT", "3", "75", "040923", 37),
  row("Cleanout Plug MPT", "4", "100", "040924", 37),
  row("Cleanout Plug MPT", "6", "150", "040926", 37),
  row("Cleanout Plug MPT", "8", "200", "040927", 37),
  row("Cleanout Plug MPT", "12", "300", "040929", 37),
  row("Closet Flange H", "4", "100", "040965", 37),
  row("Reducer Bushing Sp x H", "3 x 2", "75 x 50", "040930", 37),
  row("Reducer Bushing Sp x H", "4 x 3", "100 x 75", "040933", 37),
  row("Reducer Bushing Sp x H", "6 x 4", "150 x 100", "040896", 37),
  row("Extended Bushing Sp x H", "5 x 4", "125 x 100", "040994", 37),
  row("Extended Bushing Sp x H", "6 x 4", "150 x 100", "040939", 37),
  row("Extended Bushing Sp x H", "8 x 4", "200 x 100", "040897", 37),
  row("Extended Bushing Sp x H", "8 x 6", "200 x 150", "040940", 37),
  row("Reducer Bushing S/D to ABS/DWV Sp x H", "3 x 1-1/2", "75 x 38", "040932", 37),
  row("Reducer Bushing S/D to ABS/DWV Sp x H", "3 x 2", "75 x 50", "040341", 37),
  row("Reducer Bushing S/D to ABS/DWV Sp x H", "4 x 1-1/2", "100 x 38", "040415", 37),
  row("Reducer Bushing S/D to ABS/DWV Sp x H", "4 x 2", "100 x 50", "040935", 37),
  row("Reducer Coupling S/D to ABS/DWV H x H", "4 x 3", "100 x 75", "040655", 38),
  row("Reducer Coupling S/D to ABS/DWV H x H", "4 x 4", "100 x 100", "040725", 38),
  row("Reducer Coupling S/D to ABS/DWV H x H", "6 x 4", "150 x 100", "040727", 38),
  row("Reducer Coupling S/D to ABS/DWV H x H", "6 x 6", "150 x 150", "040756", 38),
  row("Sleeve Adapter ABS/DWV Hub to S/D H x Sp", "4", "100", "040342", 38),
  row("Adapter Bushing S/D to ABS/DWV Sp x H", "4 x 3", "100 x 75", "040934", 38),
  row("Adapter Bushing S/D to ABS/DWV Sp x H", "5 x 4", "125 x 100", "040895", 38),
  row("Adapter Bushing S/D to ABS/DWV Sp x H", "6 x 4", "150 x 100", "040941", 38),
  row("Adapter Bushing S/D to Female IPS Sp x FIP Thread", "4 x 1-1/2", "100 x 40", "040416", 38),
  row("Flush Plug MPT", "4", "100", "040992", 38),
  row("Plugs / Covers", "6", "150", "040024", 38),
  row("Plugs / Covers", "8", "200", "040025", 38),
  row("Plugs / Covers", "10", "250", "040026", 38),
  row("Floor Drain Grate Sp", "3", "75", "040811", 38),
  row("Floor Drain Grate Sp", "4", "100", "040911", 38),
  row("Floor Drain Grate Sp", "6", "150", "040912", 38),
  row("Floor Grate (pp) Sp", "3", "75", "040032", 38, { color: "White" }),
  row("Floor Grate (pp) Sp", "4", "100", "040033", 38, { color: "White" }),
  row("Floor Grate (pp) Sp", "3", "75", "040034", 38, { color: "Green" }),
  row("Floor Grate (pp) Sp", "4", "100", "040035", 38, { color: "Green" }),
  row("Grates", "6", "150", "040027", 38),
  row("Grates", "8", "200", "040028", 38),
  row("Grates", "10", "250", "040029", 38),
  row("Male Adapter H x MPT", "3", "75", "040720", 38),
  row("Male Adapter H x MPT", "4", "100", "040723", 38),
  row("Female Adapter S/D to Female IPS H x FIP Threads", "3", "75", "040948", 38),
  row("Female Adapter S/D to Female IPS H x FIP Threads", "4", "100", "040949", 38),
  row("Female Adapter S/D to Female IPS H x FIP Threads", "6", "150", "040952", 38),
  row("Female Adapter S/D to Female IPS H x FIP Threads", "8", "200", "040945", 38),
  row("Adapter S/D to AC Coupling. Or Crowle G x Sp", "4", "100", "040724", 38),
  row("Adapter to Cast Iron S/D to CI Spigot H x H Caulk with Oakum & Mortar", "4", "100", "040704", 38),
  row("DWV Hub x Sewer Spigot 10” Long", "4", "100", "040808", 38),
  row("Cleanout Adapter Sp x FIP Thread", "3", "75", "040953", 38),
  row("Cleanout Adapter Sp x FIP Thread", "4", "100", "040954", 38),
  row("Cleanout Adapter Sp x FIP Thread", "6", "150", "040956", 38),
  row("Spigot Adapter ABS/DWV to S.W. Sp x G", "4", "100", "043150", 38),
  row("Rectangular Down Spout Adapter to BDS Down spout to corrugated", "4", "100", "040960", 38),
];

const duplicateCodes = rows
  .map((item) => item.sourceCode)
  .filter((code, index, all) => all.indexOf(code) !== index);
if (duplicateCodes.length) {
  throw new Error(`Duplicate source codes: ${[...new Set(duplicateCodes)].join(", ")}`);
}

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(
  OUTPUT,
  JSON.stringify(
    {
      source: {
        title: "IPEX Modern Niagara PVC BDS catalogue",
        url: SOURCE_URL,
        localPath: "tmp/bds-ipex/catalogue-caen-ipex-modern-niagara-pvc-bds.pdf",
      },
      generatedAt: new Date().toISOString(),
      rows,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify(
    {
      ok: true,
      output: OUTPUT,
      rows: rows.length,
      categories: rows.reduce((acc, item) => {
        acc[item.category] = (acc[item.category] ?? 0) + 1;
        return acc;
      }, {}),
      first: rows[0],
      last: rows[rows.length - 1],
    },
    null,
    2,
  ),
);
