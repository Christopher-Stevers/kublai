// @ts-nocheck -- standalone catalogue source parser, tested with manufacturer rows.
const assert = require("node:assert/strict");
const SOURCE_URL = "https://www.weldbend.com/PriceSheet_1126.xlsx";
const CATALOG_URL = "https://www.weldbend.com/catalog.pdf";
function nominal(label) {
  return label
    .replaceAll('"', "")
    .split(" ")
    .reduce((n, p) => {
      const [a, b] = p.split("/").map(Number);
      return n + a / (b || 1);
    }, 0);
}
function parseFlange(sku, text, row) {
  assert(/^105[0-9A-Z]{9}$/.test(sku), "Invalid Weldbend flange SKU");
  const match = text.match(
    /^(.+) Class (150|300|600|1500) (Red )?(SLIP-ON|WELD NECK|BLIND)(?: (Std|XSB|XXSB|S 160B))? (RF|FF|RTJ)$/,
  );
  assert(match, "Unsupported flange description: " + text);
  const [, sizes, pressureClass, reducing, style, sourceBore, face] = match;
  const connectionSizes = sizes.split(" X ").map((s) => s.replaceAll("-", " "));
  assert(
    connectionSizes.every((s) => /^(?:\d+ |)\d+(?:\/\d+)?"$/.test(s)),
    "Invalid source size",
  );
  assert(connectionSizes.every((s) => nominal(s) >= 0.5 && nominal(s) <= 12));
  assert(
    reducing
      ? style === "SLIP-ON" &&
          connectionSizes.length === 2 &&
          nominal(connectionSizes[0]) > nominal(connectionSizes[1])
      : connectionSizes.length === 1,
  );
  assert(
    (style === "WELD NECK") === Boolean(sourceBore),
    "Unexpected or missing flange bore",
  );
  const fittingType = {
    "SLIP-ON": "Slip-On",
    "WELD NECK": "Weld-Neck",
    BLIND: "Blind",
  }[style];
  const imageKey = {
    "SLIP-ON": "slip-on",
    "WELD NECK": "weld-neck",
    BLIND: "blind",
  }[style];
  const bore =
    {
      Std: "STD Bore",
      XSB: "XS Bore",
      XXSB: "XXS Bore",
      "S 160B": "Schedule 160 Bore",
    }[sourceBore] || null;
  const facing = { RF: "Raised Face", FF: "Flat Face", RTJ: "Ring Type Joint" }[
    face
  ];
  const sizeLabel = connectionSizes.join(" x ");
  const displayName = `${sizeLabel} Carbon Steel ${reducing ? "Reducing " : ""}${fittingType} Flange Class ${pressureClass} ${facing}${bore ? " " + bore : ""}`;
  const abbreviation = { "SLIP-ON": "SO", "WELD NECK": "WN", BLIND: "BL" }[
    style
  ];
  const alternate = {
    "SLIP-ON": "Slip On Flange",
    "WELD NECK": "Weldneck Flange Welding Neck Flange",
    BLIND: "Blind Flange Blank Flange",
  }[style];
  return {
    manufacturer: "Weldbend",
    sku,
    manufacturerDescription: text,
    sourceUrl: SOURCE_URL,
    sourceSheet: "PriceSheetItems",
    sourceRow: row,
    catalog: "Plumbing",
    material: "Carbon Steel",
    category: "Weld Flanges",
    fittingType,
    pressureClass,
    facing,
    face,
    bore,
    sourceBore: sourceBore || null,
    reducing: !!reducing,
    connectionSizes,
    sizeLabel,
    sizeNominal: Math.max(...connectionSizes.map(nominal)),
    connectionType:
      style === "WELD NECK"
        ? "Butt-Weld"
        : style === "SLIP-ON"
          ? "Slip-On"
          : "Blind",
    standard: "ASME B16.5",
    grade: "ASTM A105 / ASME SA105",
    imageKey,
    displayName,
    description: displayName,
    aliases: [
      sku,
      `Weldbend ${sku}`,
      "Weldbend",
      text,
      alternate,
      `${sizeLabel} ${pressureClass}# CS ${face}${abbreviation}${sourceBore ? " " + sourceBore : ""}`,
      `${sizeLabel} A105 ${alternate} Class ${pressureClass} ${face}`,
    ],
  };
}
module.exports = { parseFlange, nominal, SOURCE_URL, CATALOG_URL };
