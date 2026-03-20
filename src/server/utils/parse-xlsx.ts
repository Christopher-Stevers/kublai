import { readFile, utils, type WorkSheet } from "xlsx";
import { join } from "path";

export interface ParsedPart {
  displayName: string;
  description: string;
  material: string;
  sizeNominal: number;
  sizeUnit: string;
  categoryName: string;
  partType: string;
  synonyms: string[];
  sortOrder: number;
}

/**
 * Convert a decimal to a fraction string (e.g., 1.25 -> '1-1/4', 0.5 -> '1/2')
 */
function decimalToFractionStr(decimal: number): string {
  if (decimal === 0) {
    return "0";
  }

  // Find the closest fraction with limited denominator
  const maxDenominator = 64;
  let bestNum = 1;
  let bestDenom = 1;
  let bestError = Math.abs(decimal - bestNum / bestDenom);

  for (let denom = 1; denom <= maxDenominator; denom++) {
    const num = Math.round(decimal * denom);
    const error = Math.abs(decimal - num / denom);
    if (error < bestError) {
      bestError = error;
      bestNum = num;
      bestDenom = denom;
    }
  }

  const whole = Math.floor(bestNum / bestDenom);
  const remainder = bestNum % bestDenom;

  if (whole === 0) {
    // Pure fraction
    return `${remainder}/${bestDenom}`;
  } else if (remainder === 0) {
    // Whole number
    return `${whole}`;
  } else {
    // Mixed number
    return `${whole}-${remainder}/${bestDenom}`;
  }
}

/**
 * Parse a size string like '1-1/4, 1-1/2, 2", 3", 4" x 3"' into decimal numbers
 * For reducing sizes like '4" x 3"', we take the larger size.
 */
function parseSizeString(sizeStr: string): number[] {
  if (!sizeStr || sizeStr.trim() === "") {
    return [];
  }

  const sizes: number[] = [];
  // Remove all inch symbols and extra whitespace
  const cleaned = sizeStr.replace(/"/g, "").replace(/'/g, "");
  const parts = cleaned.split(",").map((s) => s.trim());

  for (const part of parts) {
    if (!part) continue;

    // Handle reducing sizes like "4 x 3" - take the first (larger) size
    let sizePart = part;
    if (part.includes(" x ") || part.includes("x")) {
      sizePart = part.split("x")[0]?.trim() ?? "";
    }

    // Handle mixed numbers like "1-1/4" or "1-1/2"
    if (sizePart.includes("-") && sizePart.includes("/")) {
      const match = sizePart.match(/(\d+)-(\d+)\/(\d+)/);
      if (match) {
        const whole = parseInt(match[1] ?? "0");
        const num = parseInt(match[2] ?? "0");
        const denom = parseInt(match[3] ?? "1");
        sizes.push(whole + num / denom);
      }
    }
    // Handle fractions like "3/4" or "1/2"
    else if (sizePart.includes("/")) {
      const match = sizePart.match(/(\d+)\/(\d+)/);
      if (match) {
        const num = parseInt(match[1] ?? "0");
        const denom = parseInt(match[2] ?? "1");
        sizes.push(num / denom);
      }
    }
    // Handle whole numbers and decimals
    else {
      const num = parseFloat(sizePart);
      if (!isNaN(num)) {
        sizes.push(num);
      } else {
        console.warn(
          `Warning: Could not parse size '${sizePart}' from '${sizeStr}'`,
        );
      }
    }
  }

  // Remove duplicates and sort
  return [...new Set(sizes)].sort((a, b) => a - b);
}

/**
 * Extract part type from description
 */
function extractPartType(description: string): string {
  const descLower = description.toLowerCase();

  const typeKeywords: Record<string, string[]> = {
    elbow: ["elbow", "90°", "45°", "90 deg", "45 deg", "90deg", "45deg"],
    tee: ["tee", "sanitary tee", "cleanout tee", "t-fitting"],
    coupling: ["coupling", "coupler"],
    bushing: ["bushing", "bush"],
    wye: ["wye", "y-fitting"],
    cap: ["cap", "end cap"],
    flange: ["flange", "closet flange"],
    adapter: ["adapter", "adaptor"],
    union: ["union"],
    plug: ["plug"],
    nipple: ["nipple"],
    trap_adapter: ["trap adapter", "trap"],
    pipe: ["pipe", "tubing"],
    valve: ["valve", "ball valve", "gate valve", "check valve", "stop valve"],
  };

  for (const [type, keywords] of Object.entries(typeKeywords)) {
    for (const keyword of keywords) {
      if (descLower.includes(keyword.toLowerCase())) {
        return type;
      }
    }
  }

  return "fitting";
}

/**
 * Generate synonyms for a part - currently returns empty list
 */
function generateSynonyms(): string[] {
  // Synonyms are disabled for now - returning empty list
  return [];
}

/**
 * Map Excel category to code category
 */
function mapCategory(excelCategory: string): string {
  const categoryMap: Record<string, string> = {
    Fitting: "Fittings",
    Pipe: "Pipe",
    Valve: "Valves",
  };
  return categoryMap[excelCategory] || "Fittings";
}

/**
 * Parse the Material Catalogue Excel file and generate part definitions
 * @param filePath Path to the Excel file (defaults to Material Catalogue-1.xlsx)
 * @returns Array of parsed parts
 */
export function parseMaterialCatalogueFromXlsx(
  filePath: string = join(
    process.cwd(),
    "src",
    "server",
    "api",
    "routers",
    "Material Catalogue-1.xlsx",
  ),
): ParsedPart[] {
  console.log(`[LOAD] Loading: ${filePath}`);

  const workbook = readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("No sheets found in workbook");
  }
  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Sheet "${sheetName}" not found in workbook`);
  }

  // Convert to JSON
  const data = utils.sheet_to_json(worksheet) as Array<{
    Material?: string;
    Size?: string;
    Description?: string;
    Category?: string;
    Price?: string;
    SortOrder?: number | string;
  }>;

  console.log(`[PROC] Processing ${data.length} rows...`);

  const parts: ParsedPart[] = [];
  let rowCount = 0;

  for (const row of data) {
    const material = row.Material?.toString().trim() ?? "";
    const sizeStr = row.Size?.toString().trim() ?? "";
    const description = row.Description?.toString().trim() ?? "";
    const category = row.Category?.toString().trim() ?? "Fitting";
    const sortOrder = row.SortOrder !== undefined ? parseInt(row.SortOrder.toString(), 10) : 0;

    if (!material || !description) {
      continue;
    }

    const sizes = parseSizeString(sizeStr);
    const partType = extractPartType(description);
    const categoryName = mapCategory(category);

    // Create a part for each size
    if (sizes.length === 0) {
      // No size - create one part
      const synonyms = generateSynonyms();
      parts.push({
        displayName: `${description} (${material})`,
        description: `${description} made of ${material}`,
        material: material,
        sizeNominal: 0,
        sizeUnit: "in",
        categoryName: categoryName,
        partType: partType,
        synonyms: synonyms,
        sortOrder: sortOrder,
      });
    } else {
      // Create separate part for each size with fraction display
      for (const size of sizes) {
        const sizeDisplay = decimalToFractionStr(size);
        const synonyms = generateSynonyms();
        parts.push({
          displayName: `${description} - ${sizeDisplay}" (${material})`,
          description: `${description} made of ${material}, ${sizeDisplay} inch`,
          material: material,
          sizeNominal: size,
          sizeUnit: "in",
          categoryName: categoryName,
          partType: partType,
          synonyms: synonyms,
          sortOrder: sortOrder,
        });
      }
    }

    rowCount++;
    if (rowCount % 20 === 0) {
      console.log(`   Processed ${rowCount} rows...`);
    }
  }

  console.log(
    `[DONE] Generated ${parts.length} part definitions from ${rowCount} rows`,
  );

  // Generate summary
  const materialCounts: Record<string, number> = {};
  const categoryCounts: Record<string, number> = {};

  for (const part of parts) {
    materialCounts[part.material] = (materialCounts[part.material] ?? 0) + 1;
    categoryCounts[part.categoryName] =
      (categoryCounts[part.categoryName] ?? 0) + 1;
  }

  console.log("\n[SUMM] Summary by Material:");
  for (const [mat, count] of Object.entries(materialCounts).sort()) {
    console.log(`   ${mat}: ${count} parts`);
  }

  console.log("\n[SUMM] Summary by Category:");
  for (const [cat, count] of Object.entries(categoryCounts).sort()) {
    console.log(`   ${cat}: ${count} parts`);
  }

  return parts;
}

/**
 * CLI usage - run with: tsx src/server/utils/parse-xlsx.ts
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const parts = parseMaterialCatalogueFromXlsx();
  console.log("\nSample entries:");
  for (let i = 0; i < Math.min(3, parts.length); i++) {
    const part = parts[i];
    if (!part) continue;
    console.log(`\n${i + 1}. ${part.displayName}`);
    console.log(
      `   Material: ${part.material}, Size: ${part.sizeNominal}, Type: ${part.partType}`,
    );
    console.log(`   Synonyms: ${part.synonyms.join(", ") || "(none)"}`);
  }
}
