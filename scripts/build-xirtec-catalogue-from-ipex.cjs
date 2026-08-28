#!/usr/bin/env node
// @ts-nocheck
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SOURCES = [
  {
    kind: "fitting",
    material: "PVC Sch 40",
    color: "white",
    sourceId: "ipexXirtecPvcSch40WhiteFittingsPriceList",
    title: "CDN Xirtec PVC Sch 40 Ftgs White (XLS) June 1 2026",
    url: "https://ipexna.com/wp-content/uploads/2026/05/CDN-Xirtec-PVC-Sch-40-Ftgs-White-XLS-June-1-2026.xlsx",
    localPath: "tmp/xirtec-ipex/CDN-Xirtec-PVC-Sch-40-Ftgs-White-XLS-June-1-2026.xlsx",
  },
  {
    kind: "fitting",
    material: "PVC Sch 80",
    color: "grey",
    sourceId: "ipexXirtecPvcSch80FittingsPriceList",
    title: "CDN Xirtec PVC Sch 80 Ftgs (XLS) June 1 2026",
    url: "https://ipexna.com/wp-content/uploads/2026/05/CDN-Xirtec-PVC-Sch-80-Ftgs-XLS-June-1-2026.xlsx",
    localPath: "tmp/xirtec-ipex/CDN-Xirtec-PVC-Sch-80-Ftgs-XLS-June-1-2026.xlsx",
  },
  {
    kind: "pipe",
    material: "PVC Sch 40",
    color: "white",
    sourceId: "ipexXirtecPvcSch40PipeEasternPriceList",
    title: "CDN Xirtec PVC Sch 40 Pipe Eastern (XLS) June 1 2026",
    url: "https://ipexna.com/wp-content/uploads/2026/05/CDN-Xirtec-PVC-Sch-40-Pipe-Eastern-XLS-June-1-2026.xlsx",
    localPath: "tmp/xirtec-ipex/CDN-Xirtec-PVC-Sch-40-Pipe-Eastern-XLS-June-1-2026.xlsx",
  },
  {
    kind: "pipe",
    material: "PVC Sch 80",
    color: "grey",
    sourceId: "ipexXirtecPvcSch80PipeEasternPriceList",
    title: "CDN Xirtec PVC Sch 80 Pipe Eastern (XLS) June 1 2026",
    url: "https://ipexna.com/wp-content/uploads/2026/05/CDN-Xirtec-PVC-Sch-80-Pipe-Eastern-XLS-June-1-2026.xlsx",
    localPath: "tmp/xirtec-ipex/CDN-Xirtec-PVC-Sch-80-Pipe-Eastern-XLS-June-1-2026.xlsx",
  },
];
const OUTPUT = path.join(process.cwd(), "data/catalogue/xirtec-catalogue.json");

function normalize(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.map(normalize).filter(Boolean))];
}

function titleCase(value) {
  const keep = new Set([
    "PVC",
    "SOC",
    "SP",
    "FPT",
    "MPT",
    "TBE",
    "IPS",
    "PIP",
    "SS",
    "HD",
    "EPDM",
    "OD",
    "PSI",
    "TY",
  ]);
  return normalize(value)
    .toLowerCase()
    .split(" ")
    .map((word) => {
      const upper = word.toUpperCase();
      if (keep.has(upper)) return upper;
      if (word === "x") return "x";
      if (/^\d/.test(word)) return word;
      if (word === "w/") return "w/";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .replace(/\bW\/\b/g, "w/")
    .replace(/\bViton\b/g, "Viton")
    .replace(/\bBuna\b/g, "Buna")
    .replace(/\bEpdm\b/g, "EPDM")
    .replace(/\bNo-leak\b/g, "No-Leak")
    .replace(/\bFiber-loc\b/g, "Fiber-Loc");
}

function decimalToFraction(num) {
  if (Number.isInteger(num)) return String(num);
  const whole = Math.floor(Math.abs(num));
  const fractional = Math.abs(num) - whole;
  const sixteenths = Math.round(fractional * 16);
  if (sixteenths === 0) return String(num < 0 ? -whole : whole);
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(sixteenths, 16);
  return (num < 0 ? "-" : "") + (whole > 0 ? whole + "-" : "") + sixteenths / divisor + "/" + 16 / divisor;
}

function parseSizeNumber(sizeNominal) {
  const first = normalize(sizeNominal).split(/\s*(?:x|×)\s*/i)[0] || "";
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

function expandMashed(value) {
  return normalize(value)
    .replace(/PIPEP\/E/gi, "PIPE P/E")
    .replace(/PIPEB\/E/gi, "PIPE B/E")
    .replace(/P\/EWHITE/gi, "P/E WHITE")
    .replace(/P\/EGREY/gi, "P/E GREY")
    .replace(/P\/EGRAY/gi, "P/E GREY")
    .replace(/B\/EWHITE/gi, "B/E WHITE")
    .replace(/B\/EGREY/gi, "B/E GREY")
    .replace(/B\/EGRAY/gi, "B/E GREY")
    .replace(/SCH40RED/gi, "SCH40 REDUCING")
    .replace(/SCH80RED/gi, "SCH80 REDUCING")
    .replace(/MPTWHITE/gi, "MPT WHITE")
    .replace(/MPTXIRTEC/gi, "MPT XIRTEC")
    .replace(/SPxSOCWHITE/gi, "SP x SOC WHITE")
    .replace(/SPxSOCXIRTEC/gi, "SP x SOC XIRTEC")
    .replace(/REINFORCEDXIRTEC/gi, "REINFORCED XIRTEC")
    .replace(/FLANGEXIRTEC/gi, "FLANGE XIRTEC")
    .replace(/WHITEFAB/gi, "WHITE FAB")
    .replace(/PVC 80 /gi, "PVC SCH80 ")
    .replace(/SOCxSOCxSOCxSOC/gi, "SOC x SOC x SOC x SOC")
    .replace(/SOCxSOCxSOC/gi, "SOC x SOC x SOC")
    .replace(/SOCxSOC/gi, "SOC x SOC")
    .replace(/SOCxFPT/gi, "SOC x FPT")
    .replace(/SOCxMPT/gi, "SOC x MPT")
    .replace(/SXSXFPT/gi, "SOC x SOC x FPT")
    .replace(/SXSxFPT/gi, "SOC x SOC x FPT")
    .replace(/FPTxFPTxFPT/gi, "FPT x FPT x FPT")
    .replace(/FPTxFPT/gi, "FPT x FPT")
    .replace(/FPTxMPT/gi, "FPT x MPT")
    .replace(/MPTxSOC/gi, "MPT x SOC")
    .replace(/MPTxFPT/gi, "MPT x FPT")
    .replace(/SPxSOC/gi, "SP x SOC")
    .replace(/SPxFPT/gi, "SP x FPT")
    .replace(/SPxSP/gi, "SP x SP")
    .replace(/BENDSP/gi, "BEND SP")
    .replace(/NIPPLETBE/gi, "NIPPLE TBE")
    .replace(/CLOSENIPPLE/gi, "CLOSE NIPPLE")
    .replace(/STREETELBOW/gi, "STREET ELBOW")
    .replace(/VANSTONEFLANGE/gi, "VANSTONE FLANGE")
    .replace(/BLIND FLANGE/gi, "BLIND FLANGE")
    .replace(/BULKHEADUNION/gi, "BULKHEAD UNION")
    .replace(/REDUCINGTEE/gi, "REDUCING TEE")
    .replace(/REDUCINGTEESOC/gi, "REDUCING TEE SOC")
    .replace(/MALEADAPTER/gi, "MALE ADAPTER")
    .replace(/COUPLINGSOC/gi, "COUPLING SOC")
    .replace(/COUPLINGFPT/gi, "COUPLING FPT")
    .replace(/INSERTxIPS/gi, "INSERT x IPS")
    .replace(/HOSExMPT/gi, "HOSE x MPT")
    .replace(/O\.D\.xSOC/gi, "OD x SOC")
    .replace(/O\.D\.xFPT/gi, "OD x FPT")
    .replace(/\bADPT\b/gi, "ADAPTER")
    .replace(/\bCPLG\b/gi, "COUPLING")
    .replace(/\bOTLT\b/gi, "OUTLET")
    .replace(/\bGSKT\b/gi, "GASKET")
    .replace(/VIT\./gi, "VITON")
    .replace(/CONC\./gi, "CONCENTRIC")
    .replace(/RED\./gi, "REDUCING")
    .replace(/\bRED\b/gi, "REDUCING")
    .replace(/WHITEXIRTEC/gi, "WHITE XIRTEC")
    .replace(/XIRTECPVC/gi, "XIRTEC PVC")
    .replace(/FABXIRTEC/gi, "FAB XIRTEC")
    .replace(/SOCFAB/gi, "SOC FAB")
    .replace(/NO-\s*LEAK/gi, "NO-LEAK")
    .replace(/FIBER-\s*LOC/gi, "FIBER-LOC")
    .replace(/\s+/g, " ");
}

function extractSizesAndAngles(prefix) {
  const sizes = [];
  const angles = [];
  const cleaned = normalize(prefix).replace(/[”″]/g, "\"");
  const withoutAngles = cleaned.replace(/(\d+(?:\s+\d\/\d)?)\s*D\b/gi, " ");
  for (const match of cleaned.matchAll(/(\d+(?:\s+\d\/\d)?)\s*D\b/gi)) {
    angles.push(match[1].replace(/\s+/g, " "));
  }
  for (const segment of withoutAngles.split(/[xX]/)) {
    const match = /(\d+\s+\d\/\d|\d+\/\d|\d+)(?:\s*")?/.exec(normalize(segment));
    if (match && /"|inch|\d/.test(segment) && !/MM/i.test(segment)) {
      sizes.push(normalizeSizeToken(match[1]));
    }
  }
  return { sizes: [...new Set(sizes)], angles: [...new Set(angles)] };
}

function isSocketOnly(connection) {
  return /^SOC(?:\s*x\s*SOC)*$/i.test(normalize(connection));
}

function isImpliedBushingConnection(connection) {
  return /^SP\s*x\s*SOC$/i.test(normalize(connection));
}

function isImpliedBendConnection(connection) {
  return /^SP\s*x\s*SP$/i.test(normalize(connection));
}

function connectionFamily(label) {
  if (/\bStreet\b/i.test(label)) return "keep";
  if (/\bSide Outlet\b/i.test(label)) return "keep-if-not-socket";
  if (/\bAdapter\b/i.test(label)) return "keep";
  if (/\bCap\b/i.test(label) || /\bPlug\b/i.test(label)) return "keep";
  if (/\bUnion\b/i.test(label) || /\bFlange\b/i.test(label)) return "keep";
  if (/\bSaddle\b/i.test(label) || /\bHose\b/i.test(label)) return "keep";
  if (/\bBushing\b/i.test(label)) return "bushing";
  if (/\bBend\b/i.test(label)) return "bend";
  if (/\bNipple\b/i.test(label) || /\bExtension\b/i.test(label)) return "keep";
  if (/\bExpansion Joint\b/i.test(label) || /\bBulkhead\b/i.test(label)) return "keep";
  return "omit-socket";
}

function shouldKeepConnection(label, connection) {
  if (!connection) return false;
  const family = connectionFamily(label);
  if (family === "keep") return true;
  if (family === "keep-if-not-socket") return !isSocketOnly(connection);
  if (family === "bushing") return !isImpliedBushingConnection(connection);
  if (family === "bend") return !isImpliedBendConnection(connection);
  return !isSocketOnly(connection);
}

function cleanFittingLabel(rest, angles, fabricated) {
  let label = normalize(rest);
  const connectionMatch =
    /(\b(?:SOC|SP|FPT|MPT|HOSE|INSERT|IPS|OD|TBE)\s*x\s*(?:SOC|SP|FPT|MPT|HOSE|INSERT|IPS|OD|TBE)(?:\s*x\s*(?:SOC|SP|FPT|MPT))*|\bSOC\b|\bSP\b|\bFPT\b|\bMPT\b|\bTBE\b)$/i.exec(
      label,
    );
  const connection = connectionMatch ? normalize(connectionMatch[0]) : "";
  if (connection) label = normalize(label.slice(0, -connection.length));

  label = label
    .replace(/\bSAN TEE\b|\bSANTEE\b/gi, "TY")
    .replace(/\bELBOW\b/gi, "")
    .replace(/\bFLUSH REDUCING BUSHING\b/gi, "Flush Bushing")
    .replace(/\bREDUCING BUSHING\b/gi, "Bushing")
    .replace(/\bFLUSH BUSHING\b/gi, "Flush Bushing")
    .replace(/\bBUSHING\b/gi, "Bushing")
    .replace(/\bREDUCING COUPLING\b/gi, "Reducing Coupling")
    .replace(/\bCONCENTRIC REDUCING COUPLING\b/gi, "Concentric Reducing Coupling")
    .replace(/\bCOUPLING\b/gi, "Coupling")
    .replace(/\bREDUCING TEE\b/gi, "Reducing Tee")
    .replace(/\bTEE\b/gi, "Tee")
    .replace(/\bWYE\b/gi, "Wye")
    .replace(/\bCROSS\b/gi, "Cross")
    .replace(/\bSTREET\b/gi, "Street")
    .replace(/\bSIDE OUTLET\b/gi, "Side Outlet")
    .replace(/\bFEMALE ADAPTER\b/gi, "Female Adapter")
    .replace(/\bMALE ADAPTER\b/gi, "Male Adapter")
    .replace(/\bHOSE ADAPTER\b/gi, "Hose Adapter")
    .replace(/\bCLOSE NIPPLE\b/gi, "Close Nipple")
    .replace(/\bNIPPLE\b/gi, "Nipple")
    .replace(/\bONE PIECE FLANGE\b/gi, "One Piece Flange")
    .replace(/\bVANSTONE FLANGE\b/gi, "Vanstone Flange")
    .replace(/\bBLIND FLANGE\b/gi, "Blind Flange")
    .replace(/\bNO-LEAK\/WATERSTOP FLANGE\b/gi, "No-Leak Waterstop Flange")
    .replace(/\bWATERSTOP FLANGE\b/gi, "Waterstop Flange")
    .replace(/\bBULKHEAD UNION\b/gi, "Bulkhead Union")
    .replace(/\bUNION\b/gi, "Union")
    .replace(/\bSADDLE PIPE\b/gi, "Saddle")
    .replace(/\bRISER EXTENSION\b/gi, "Riser Extension")
    .replace(/\bIPS TO PIP ADAPTER\b/gi, "IPS to PIP Adapter")
    .replace(/\bTRAVEL EXPANSION JOINT\b/gi, "Travel Expansion Joint")
    .replace(/\bEXPANSION JOINT\b/gi, "Expansion Joint")
    .replace(/\bU BEND\b/gi, "U Bend")
    .replace(/\bCAP\b/gi, "Cap")
    .replace(/\bPLUG\b/gi, "Plug")
    .replace(/\bBEND\b/gi, "Radius Bend");

  if (/\bCoupling\b/i.test(label) && !/Reduc|Concentric/i.test(label) && (rest.match(/x/gi) || []).length >= 1) {
    // reducing vs plain is handled from source wording
  }
  if (/\bBushing\b/i.test(label) && /Reduc/i.test(label) && !/Flush/i.test(label)) {
    label = label.replace(/\bReducing Bushing\b/i, "Bushing");
  }

  label = titleCase(label)
    .replace(/Reducing Reducing/gi, "Reducing")
    .replace(/\bSs\b/g, "SS")
    .replace(/\bHd\b/g, "HD")
    .replace(/\bOd\b/g, "OD")
    .replace(/W\/ /g, "w/ ")
    .replace(/\s+/g, " ")
    .trim();

  if (angles.length) {
    const angle = angles.join(" x ").replace(/22\.5/g, "22 1/2").replace(/11\.25/g, "11 1/4");
    if (!(/\bWye\b/i.test(label) && angle === "45")) {
      label = normalize(angle + " " + label);
    }
  }

  if (shouldKeepConnection(label, connection)) {
    label = normalize(label + " " + connection.replace(/x/g, "x"));
    label = label
      .replace(/SOC x SOC x SOC x SOC/gi, "SOC x SOC x SOC x SOC")
      .replace(/\bSoc\b/g, "SOC")
      .replace(/\bSp\b/g, "SP")
      .replace(/\bFpt\b/g, "FPT")
      .replace(/\bMpt\b/g, "MPT")
      .replace(/\bTbe\b/g, "TBE");
  }

  if (fabricated && !/\bFabricated\b/i.test(label)) {
    label = normalize(label + " Fabricated");
  }

  return normalize(label)
    .replace(/\s+x\s+/g, " x ")
    .replace(/\s+/g, " ");
}

function skipReason(raw, source, row) {
  if (normalize(row["Obsolete/No Longer Replnsh."])) return "obsolete/no longer replenished";
  if (/\bPIPE CLAMP|\bPIPE STRAP|\bSTRUT BASE|\bFLANGE GASKET|\bFLANGE GSKT|\bCOATED STEEL/i.test(raw)) {
    return "accessory clamp/strap/gasket row";
  }
  if (source.kind === "pipe") {
    if (source.material === "PVC Sch 40" && !/\bWHITE\b/i.test(raw)) return "grey Sch 40 pipe excluded";
    if (!/\bPIPE\b/i.test(raw)) return "not pipe";
    return null;
  }
  if (/\bGREY\b|\bGRAY\b/i.test(raw) && source.material === "PVC Sch 40") return "grey Sch 40 fitting excluded";
  if (!/\bSCH\s*40\b|\bSCH40\b|\bSCH\s*80\b|\bSCH80\b|\bS40\b/i.test(raw)) {
    return "not a Sch 40/80 fitting row";
  }
  if (/^\d+MM\b/i.test(normalize(raw)) && !/"/.test(raw.split(/\bPVC\b/i)[0] || "")) {
    return "metric-only duplicate row";
  }
  return null;
}

function splitDescription(desc) {
  const classic = /\bPVC\s*SCH\s*(40|80)\b/i.exec(desc);
  if (classic) {
    return {
      prefix: desc.slice(0, classic.index),
      rest: desc.slice(classic.index + classic[0].length),
    };
  }
  const s40 = /\bS40\b/i.exec(desc);
  if (s40) {
    return {
      prefix: desc.slice(0, s40.index),
      rest: desc.slice(s40.index + s40[0].length),
    };
  }
  const sch = /\bSCH\s*(40|80)\b/i.exec(desc);
  if (!sch) return null;
  const prefixMatch = desc.match(
    /^((?:\d+\s+\d\/\d|\d+\/\d|\d+)\s*"?(?:\s*[xX]\s*(?:\d+\s+\d\/\d|\d+\/\d|\d+)\s*"?)*)/,
  );
  const prefix = prefixMatch ? prefixMatch[1] : "";
  return {
    prefix,
    rest: desc.slice(prefix.length).replace(/\bSCH\s*(40|80)\b/i, " "),
  };
}

function parsePipe(raw, source, row) {
  const desc = expandMashed(raw);
  const match =
    /^(\d+(?:\s+\d\/\d)?|\d\/\d)"\s*x\s*(\d+)'\s*PVC\s*SCH\s*(40|80)\s*PIPE\s*(P\/E|B\/E)/i.exec(desc);
  if (!match) return { skipped: "could not parse pipe size/length/end" };
  const sizeNominal = normalizeSizeToken(match[1]);
  const lengthFt = match[2];
  const end = /P\/E/i.test(match[4]) ? "Plain End" : "Bell End";
  const description = `Pipe ${lengthFt} ft ${end}`;
  const sizeLabel = formatSizeLabel(sizeNominal);
  return {
    catalog: "Plumbing",
    category: "Pipe",
    material: source.material,
    sizeNominal,
    sizeUnit: "in",
    sizeLabel,
    displayName: `${sizeLabel} ${source.material} ${description}`,
    description,
    imageUrl: "",
    aliases: unique([
      "IPEX Xirtec",
      "Xirtec",
      source.material,
      `${source.material} Pipe`,
      raw,
      `IPEX ${raw}`,
      row["P-Code"],
      row["UPC-Code"],
      row["Universal Number"],
      source.color,
      end,
      `${lengthFt} ft`,
    ]),
    manufacturerSources: [source.sourceId],
    supplierParts: [],
    sourcePCode: normalize(row["P-Code"]),
    sourceUpc: normalize(row["UPC-Code"]),
    sourceUniversalNumber: normalize(row["Universal Number"]),
    sourceDescription: raw,
    sourcePer: normalize(row["/Per"]),
    sourceListPrice: normalize(row["List Price"]),
  };
}

function parseFitting(raw, source, row) {
  const desc = expandMashed(raw);
  const split = splitDescription(desc);
  if (!split) return { skipped: "missing PVC SCH40/80 marker" };
  const prefix = split.prefix;
  let rest = split.rest;
  const fabricated = /\bFAB\b/i.test(rest);
  rest = rest
    .replace(/xirtec/gi, " ")
    .replace(/whitefab/gi, " FAB ")
    .replace(/\bWHITE\b/gi, " ")
    .replace(/\bGREY\b|\bGRAY\b/gi, " ")
    .replace(/\bXIRTEC\b/gi, " ")
    .replace(/\bPVC\b/gi, " ")
    .replace(/\bFAB\b/gi, " ")
    .replace(/\bS40\b/gi, " ")
    .replace(/\bWHT\b/gi, " ")
    .replace(/\b\d{2,3}\s*PSI\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const extracted = extractSizesAndAngles(prefix);
  if (!extracted.sizes.length) return { skipped: "could not parse size prefix" };
  const sizeNominal = extracted.sizes.join(" x ");
  const description = cleanFittingLabel(rest, extracted.angles, fabricated);
  if (!description) return { skipped: "empty cleaned label" };
  const sizeLabel = formatSizeLabel(sizeNominal);
  return {
    catalog: "Plumbing",
    category: "Fitting",
    material: source.material,
    sizeNominal,
    sizeUnit: "in",
    sizeLabel,
    displayName: `${sizeLabel} ${source.material} ${description}`,
    description,
    imageUrl: "",
    aliases: unique([
      "IPEX Xirtec",
      "Xirtec",
      source.material,
      raw,
      `IPEX ${raw}`,
      row["P-Code"],
      row["UPC-Code"],
      row["Universal Number"],
      source.color,
      rest,
      extracted.angles.length ? extracted.angles.join(" x ") + " " + description : "",
      fabricated ? "Fabricated" : "",
    ]),
    manufacturerSources: [source.sourceId],
    supplierParts: [],
    sourcePCode: normalize(row["P-Code"]),
    sourceUpc: normalize(row["UPC-Code"]),
    sourceUniversalNumber: normalize(row["Universal Number"]),
    sourceDescription: raw,
    sourcePer: normalize(row["/Per"]),
    sourceListPrice: normalize(row["List Price"]),
  };
}

function rowToPart(row, source) {
  const raw = normalize(row["Prod-Desc"]);
  const expanded = expandMashed(raw);
  const skipped = skipReason(expanded, source, row);
  if (skipped) return { skipped };
  if (source.kind === "pipe") return parsePipe(expanded, source, row);
  return parseFitting(expanded, source, row);
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
      ...(existing.aliases || []),
      ...(row.aliases || []),
      row.displayName,
      row.description,
    ]);
    existing.manufacturerSources = unique([
      ...(existing.manufacturerSources || []),
      ...(row.manufacturerSources || []),
    ]);
    existing.sourcePCode = unique([existing.sourcePCode, row.sourcePCode]).join("; ");
    existing.sourceUpc = unique([existing.sourceUpc, row.sourceUpc]).join("; ");
    existing.sourceUniversalNumber = unique([
      existing.sourceUniversalNumber,
      row.sourceUniversalNumber,
    ]).join("; ");
    existing.sourceDescription = unique([existing.sourceDescription, row.sourceDescription]).join(" | ");
    existing.sourcePer = unique([existing.sourcePer, row.sourcePer]).join("; ");
    existing.sourceListPrice = "";
  }
  return [...byName.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { numeric: true }),
  );
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
    if (part.skipped) {
      skipped.push({
        source: source.sourceId,
        index: index + 2,
        reason: part.skipped,
        sourceDescription: sourceRow["Prod-Desc"],
      });
    } else {
      parts.push(part);
    }
  }
}

const rows = mergeRows(parts);
const data = {
  sourceSet: {
    name: "IPEX Xirtec PVC Sch 40 and Sch 80 catalogue import",
    status: "ipex-current-price-list-derived",
    notes: [
      "Rows are derived from official IPEX current June 1 2026 Xirtec PVC Sch 40 White fittings, Sch 80 fittings, and Eastern pipe XLS price lists.",
      "Sch 40 uses white pipe and white fittings. Grey Sch 40 pipe/fittings are excluded to keep PVC Sch 40 and PVC Sch 80 as distinct app materials.",
      "Pipe clamps, straps, flange gaskets, and metric-only duplicate rows are excluded.",
      "Descriptions are clean labels without material or size.",
      "Socket-only SOC x SOC connection text is treated as implied for standard elbows, tees, couplings, crosses, and wyes.",
      "Bushing SP x SOC and radius-bend SP x SP are implied and moved to aliases. FPT/MPT/street/adapter/flange variants stay in the label.",
      "Angle fittings display by degree. Wye 45 is omitted because 45 is implied for wyes.",
      "Reducing bushings display as Bushing; reducing tees/couplings keep Reducing.",
      "Fabricated source rows keep Fabricated in the app label so they stay distinct from molded parts.",
      "Images remain blank until a verified Xirtec-specific image is available.",
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

const counts = rows.reduce(
  (acc, row) => {
    const key = row.material + " " + row.category;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  },
  {},
);
const skipCounts = skipped.reduce((acc, row) => {
  acc[row.reason] = (acc[row.reason] || 0) + 1;
  return acc;
}, {});
console.log(
  JSON.stringify(
    {
      ok: true,
      output: OUTPUT,
      sourceRows,
      importedSourceRows: parts.length,
      mergedRows: rows.length,
      skippedRows: skipped.length,
      counts,
      skipCounts,
      samples: rows.slice(0, 12).map((row) => row.displayName),
    },
    null,
    2,
  ),
);
