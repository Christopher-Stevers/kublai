import { and, eq } from "drizzle-orm";
import type { db } from "~/server/db";
import {
  categories,
  materials,
  partDefinitions,
  partSynonyms,
  partTypes,
  sizes,
  suppliers,
  supplierParts,
  units,
} from "~/server/db/schema";

type Database = typeof db;

// Seed data constants
const unitDefinitions = [
  { code: "in", kind: "length", displayName: "Inch" },
  { code: "ft", kind: "length", displayName: "Foot" },
  { code: "mm", kind: "length", displayName: "Millimeter" },
  { code: "ea", kind: "count", displayName: "Each" },
];

// Root categories only - no child categories
const rootCategories = [
  "Fittings",
  "Valves",
  "Fixtures",
  "Pipe",
  "Other",
];

// Part definitions - all reference root categories directly
// Expanded selection to ensure users have parts to choose from
const partDefinitionsData = [
  // Fittings category
  {
    categoryName: "Fittings",
    displayName: "90° Copper Elbow",
    description: "90 degree copper elbow fitting for water lines",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["copper 90", "90 elbow", "copper elbow 90"],
  },
  {
    categoryName: "Fittings",
    displayName: "90° PVC Elbow",
    description: "90 degree PVC elbow fitting",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["PVC 90", "90 PVC elbow"],
  },
  {
    categoryName: "Fittings",
    displayName: "45° Copper Elbow",
    description: "45 degree copper elbow fitting",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["copper 45", "45 elbow"],
  },
  {
    categoryName: "Fittings",
    displayName: "90° PEX Elbow",
    description: "90 degree PEX elbow fitting",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["PEX 90", "90 PEX elbow"],
  },
  {
    categoryName: "Fittings",
    displayName: "45° PEX Elbow",
    description: "45 degree PEX elbow fitting",
    material: "PEX",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["PEX 45", "45 PEX elbow"],
  },
  {
    categoryName: "Fittings",
    displayName: "Copper Tee",
    description: "Copper tee fitting for branch connections",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "tee",
    synonyms: ["copper tee", "T fitting", "copper T"],
  },
  {
    categoryName: "Fittings",
    displayName: "PVC Tee",
    description: "PVC tee fitting",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "tee",
    synonyms: ["PVC tee", "PVC T"],
  },
  {
    categoryName: "Fittings",
    displayName: "PEX Tee",
    description: "PEX tee fitting",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "tee",
    synonyms: ["PEX tee", "PEX T"],
  },
  {
    categoryName: "Fittings",
    displayName: "Reducing Tee",
    description: "Copper reducing tee fitting",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "tee",
    synonyms: ["reducing tee", "copper reducing tee"],
  },
  {
    categoryName: "Fittings",
    displayName: "Copper Coupling",
    description: "Straight copper coupling",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "coupling",
    synonyms: ["copper coupling", "straight coupling"],
  },
  {
    categoryName: "Fittings",
    displayName: "PVC Coupling",
    description: "PVC coupling for pipe connections",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "coupling",
    synonyms: ["PVC coupling"],
  },
  {
    categoryName: "Fittings",
    displayName: "PEX Coupling",
    description: "PEX coupling for pipe connections",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "coupling",
    synonyms: ["PEX coupling"],
  },
  {
    categoryName: "Fittings",
    displayName: "Copper Coupler",
    description: "Copper coupler fitting",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "coupler",
    synonyms: ["copper coupler"],
  },
  // Valves category
  {
    categoryName: "Valves",
    displayName: '1/2" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "ball valve",
    synonyms: ["ball valve", "quarter turn valve"],
  },
  {
    categoryName: "Valves",
    displayName: '3/4" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "ball valve",
    synonyms: ["ball valve 3/4", "3/4 ball valve"],
  },
  {
    categoryName: "Valves",
    displayName: '1" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 1.0,
    sizeUnit: "in",
    partType: "ball valve",
    synonyms: ["ball valve 1", "1 ball valve"],
  },
  {
    categoryName: "Valves",
    displayName: '1/2" Gate Valve',
    description: "Gate valve for water shutoff",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "gate valve",
    synonyms: ["gate valve", "shutoff valve"],
  },
  {
    categoryName: "Valves",
    displayName: '3/4" Gate Valve',
    description: "Gate valve for water shutoff",
    material: "Brass",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "gate valve",
    synonyms: ["gate valve 3/4", "3/4 gate valve"],
  },
  {
    categoryName: "Valves",
    displayName: '1/2" Check Valve',
    description: "Check valve to prevent backflow",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "check valve",
    synonyms: ["check valve", "backflow preventer"],
  },
  {
    categoryName: "Valves",
    displayName: '3/4" Check Valve',
    description: "Check valve to prevent backflow",
    material: "Brass",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "check valve",
    synonyms: ["check valve 3/4", "3/4 check valve"],
  },
  // Fixtures category
  {
    categoryName: "Fixtures",
    displayName: "Kitchen Faucet",
    description: "Single-handle kitchen faucet",
    material: "Chrome",
    sizeNominal: null,
    sizeUnit: null,
    partType: "faucet",
    synonyms: ["kitchen faucet", "faucet"],
  },
  {
    categoryName: "Fixtures",
    displayName: "Bathroom Faucet",
    description: "Two-handle bathroom faucet",
    material: "Chrome",
    sizeNominal: null,
    sizeUnit: null,
    partType: "faucet",
    synonyms: ["bathroom faucet", "lavatory faucet"],
  },
  {
    categoryName: "Fixtures",
    displayName: "Toilet",
    description: "Standard two-piece toilet",
    material: "Porcelain",
    sizeNominal: null,
    sizeUnit: null,
    partType: "toilet",
    synonyms: ["toilet", "commode"],
  },
  {
    categoryName: "Fixtures",
    displayName: "Kitchen Sink",
    description: "Double-bowl kitchen sink",
    material: "Stainless Steel",
    sizeNominal: null,
    sizeUnit: null,
    partType: "sink",
    synonyms: ["kitchen sink", "sink"],
  },
  {
    categoryName: "Fixtures",
    displayName: "Bathroom Sink",
    description: "Pedestal bathroom sink",
    material: "Porcelain",
    sizeNominal: null,
    sizeUnit: null,
    partType: "sink",
    synonyms: ["bathroom sink", "lavatory sink"],
  },
  // Pipe category
  {
    categoryName: "Pipe",
    displayName: '1/2" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "type L copper",
    synonyms: ["copper pipe", "type L copper", "1/2 copper"],
  },
  {
    categoryName: "Pipe",
    displayName: '3/4" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "type L copper",
    synonyms: ["copper pipe 3/4", "3/4 copper"],
  },
  {
    categoryName: "Pipe",
    displayName: '1" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 1.0,
    sizeUnit: "in",
    partType: "type L copper",
    synonyms: ["copper pipe 1", "1 copper"],
  },
  {
    categoryName: "Pipe",
    displayName: '1/2" PVC Schedule 40 Pipe',
    description: "PVC schedule 40 pipe, 10 foot length",
    material: "PVC",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "schedule 40",
    synonyms: ["PVC pipe", "schedule 40 PVC", "1/2 PVC"],
  },
  {
    categoryName: "Pipe",
    displayName: '3/4" PVC Schedule 40 Pipe',
    description: "PVC schedule 40 pipe, 10 foot length",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "schedule 40",
    synonyms: ["PVC pipe", "schedule 40 PVC", "3/4 PVC"],
  },
  {
    categoryName: "Pipe",
    displayName: '1" PVC Schedule 40 Pipe',
    description: "PVC schedule 40 pipe, 10 foot length",
    material: "PVC",
    sizeNominal: 1.0,
    sizeUnit: "in",
    partType: "schedule 40",
    synonyms: ["PVC pipe", "schedule 40 PVC", "1 PVC"],
  },
  {
    categoryName: "Pipe",
    displayName: '1/2" PEX Pipe',
    description: "PEX pipe, 100 foot coil",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "PEX pipe",
    synonyms: ["PEX pipe", "1/2 PEX"],
  },
  {
    categoryName: "Pipe",
    displayName: '3/4" PEX Pipe',
    description: "PEX pipe, 100 foot coil",
    material: "PEX",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "PEX pipe",
    synonyms: ["PEX pipe", "3/4 PEX"],
  },
  {
    categoryName: "Pipe",
    displayName: '1" PEX Pipe',
    description: "PEX pipe, 100 foot coil",
    material: "PEX",
    sizeNominal: 1.0,
    sizeUnit: "in",
    partType: "PEX pipe",
    synonyms: ["PEX pipe", "1 PEX"],
  },
];

/**
 * Seed an organization with default parts, categories, materials, and part types
 */
export async function seedOrganization(
  db: Database,
  organizationId: string,
): Promise<void> {
  // Step 1: Create or get units (global, so check if they exist first)
  const unitMap = new Map<string, string>();
  for (const unitDef of unitDefinitions) {
    const [existing] = await db
      .select()
      .from(units)
      .where(eq(units.code, unitDef.code))
      .limit(1);

    if (existing) {
      unitMap.set(unitDef.code, existing.id);
    } else {
      const [unit] = await db
        .insert(units)
        .values(unitDef)
        .returning({ id: units.id });
      if (unit) {
        unitMap.set(unitDef.code, unit.id);
      }
    }
  }

  // Step 2: Create root categories only (no child categories)
  const categoryMap = new Map<string, string>();

  for (const categoryName of rootCategories) {
    const [existing] = await db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.name, categoryName),
          eq(categories.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existing) {
      categoryMap.set(categoryName, existing.id);
    } else {
      const [category] = await db
        .insert(categories)
        .values({
          organizationId: organizationId,
          name: categoryName,
          sortOrder: 0,
        })
        .returning({ id: categories.id });
      if (!category) {
        throw new Error(`Failed to create category ${categoryName}`);
      }
      categoryMap.set(categoryName, category.id);
    }
  }

  // Step 3: Create materials (org-specific)
  const materialSet = new Set<string>();
  for (const partData of partDefinitionsData) {
    if (partData.material) {
      materialSet.add(partData.material);
    }
  }
  const materialMap = new Map<string, string>();
  for (const materialName of Array.from(materialSet)) {
    const [existing] = await db
      .select()
      .from(materials)
      .where(
        and(
          eq(materials.name, materialName),
          eq(materials.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existing) {
      materialMap.set(materialName, existing.id);
    } else {
      const [material] = await db
        .insert(materials)
        .values({
          organizationId: organizationId,
          name: materialName,
        })
        .returning({ id: materials.id });
      if (material) {
        materialMap.set(materialName, material.id);
      }
    }
  }

  // Step 4: Create part types (org-specific)
  const partTypeSet = new Set<string>();
  for (const partData of partDefinitionsData) {
    if (partData.partType) {
      partTypeSet.add(partData.partType);
    }
  }
  const partTypeMap = new Map<string, string>();
  for (const partTypeName of Array.from(partTypeSet)) {
    const [existing] = await db
      .select()
      .from(partTypes)
      .where(
        and(
          eq(partTypes.name, partTypeName),
          eq(partTypes.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existing) {
      partTypeMap.set(partTypeName, existing.id);
    } else {
      const [partType] = await db
        .insert(partTypes)
        .values({
          organizationId: organizationId,
          name: partTypeName,
        })
        .returning({ id: partTypes.id });
      if (partType) {
        partTypeMap.set(partTypeName, partType.id);
      }
    }
  }

  // Step 5: Create sizes (org-specific) - unique combinations of nominal and unit
  const sizeSet = new Set<string>();
  for (const partData of partDefinitionsData) {
    if (partData.sizeNominal !== null && partData.sizeNominal !== undefined && partData.sizeUnit) {
      // Create a unique key for the size combination
      const sizeKey = `${partData.sizeNominal}_${partData.sizeUnit}`;
      sizeSet.add(sizeKey);
    }
  }
  const sizeMap = new Map<string, string>();
  for (const sizeKey of Array.from(sizeSet)) {
    const parts = sizeKey.split("_");
    if (parts.length !== 2) {
      console.warn(`Invalid size key format: ${sizeKey}`);
      continue;
    }
    const [nominalStr, unitCode] = parts;
    if (!nominalStr || !unitCode) {
      console.warn(`Invalid size key format: ${sizeKey}`);
      continue;
    }
    const nominal = parseFloat(nominalStr);
    if (isNaN(nominal)) {
      console.warn(`Invalid nominal value in size key: ${sizeKey}`);
      continue;
    }
    const unitId = unitMap.get(unitCode);
    
    if (!unitId) {
      console.warn(`Unit "${unitCode}" not found for size ${sizeKey}`);
      continue;
    }

    // Check if size already exists
    const [existing] = await db
      .select()
      .from(sizes)
      .where(
        and(
          eq(sizes.organizationId, organizationId),
          eq(sizes.nominal, nominal.toString()),
          eq(sizes.unitId, unitId),
        ),
      )
      .limit(1);

    if (existing) {
      sizeMap.set(sizeKey, existing.id);
    } else {
      const [size] = await db
        .insert(sizes)
        .values({
          organizationId: organizationId,
          nominal: nominal.toString(),
          unitId: unitId,
        })
        .returning({ id: sizes.id });
      if (size) {
        sizeMap.set(sizeKey, size.id);
      }
    }
  }

  // Step 6: Create parts
  const defaultUomId = unitMap.get("ea");
  if (!defaultUomId) {
    throw new Error('Unit "ea" not found - required for default UOM');
  }

  for (const partData of partDefinitionsData) {
    const categoryId = categoryMap.get(partData.categoryName);
    if (!categoryId) {
      console.warn(
        `Category "${partData.categoryName}" not found for part "${partData.displayName}"`,
      );
      continue;
    }

    // Get sizeId from sizeMap (created in Step 5)
    const sizeKey =
      partData.sizeNominal !== null &&
      partData.sizeNominal !== undefined &&
      partData.sizeUnit
        ? `${partData.sizeNominal}_${partData.sizeUnit}`
        : null;
    const sizeId = sizeKey ? sizeMap.get(sizeKey) ?? null : null;

    // If no sizeId found but we have size data, create it
    let finalSizeId = sizeId;
    if (!finalSizeId && sizeKey) {
      const parts = sizeKey.split("_");
      if (parts.length === 2) {
        const [nominalStr, unitCode] = parts;
        const nominal = parseFloat(nominalStr ?? "0");
        const unitId = unitMap.get(unitCode ?? "");
        if (unitId && !isNaN(nominal)) {
          const [newSize] = await db
            .insert(sizes)
            .values({
              organizationId: organizationId,
              nominal: nominal.toString(),
              unitId: unitId,
            })
            .returning({ id: sizes.id });
          if (newSize) {
            finalSizeId = newSize.id;
            sizeMap.set(sizeKey, newSize.id);
          }
        }
      }
    }

    // If still no sizeId, create a default "no size" size
    if (!finalSizeId) {
      const defaultSizeKey = "0_ea";
      let defaultSizeId = sizeMap.get(defaultSizeKey);
      if (!defaultSizeId) {
        const defaultUnitId = unitMap.get("ea");
        if (defaultUnitId) {
          const [newDefaultSize] = await db
            .insert(sizes)
            .values({
              organizationId: organizationId,
              nominal: "0",
              unitId: defaultUnitId,
            })
            .returning({ id: sizes.id });
          if (newDefaultSize) {
            defaultSizeId = newDefaultSize.id;
            sizeMap.set(defaultSizeKey, newDefaultSize.id);
          }
        }
      }
      finalSizeId = defaultSizeId ?? null;
    }

    if (!finalSizeId) {
      console.warn(
        `Failed to get or create size for part "${partData.displayName}"`,
      );
      continue;
    }

    const materialId = partData.material
      ? materialMap.get(partData.material) ?? null
      : null;

    const partTypeId = partData.partType
      ? partTypeMap.get(partData.partType) ?? null
      : null;

    // Check if part already exists
    const [existing] = await db
      .select()
      .from(partDefinitions)
      .where(
        and(
          eq(partDefinitions.displayName, partData.displayName),
          eq(partDefinitions.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (existing) {
      continue; // Skip if already exists
    }

    const [part] = await db
      .insert(partDefinitions)
      .values({
        organizationId: organizationId,
        categoryId: categoryId,
        displayName: partData.displayName,
        description: partData.description,
        imageUrl: null,
        partTypeId: partTypeId,
        materialId: materialId,
        sizeId: finalSizeId ?? null,
        defaultUomId: defaultUomId,
        isActive: true,
      })
      .returning({ id: partDefinitions.id });

    if (part) {
      // Create synonyms
      for (const synonym of partData.synonyms) {
        await db.insert(partSynonyms).values({
          partDefinitionId: part.id,
          synonym: synonym,
        });
      }
    }
  }

  // Step 7: Create a default supplier for the organization
  const [defaultSupplier] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.name, "Default Supplier"),
        eq(suppliers.organizationId, organizationId),
      ),
    )
    .limit(1);

  let supplierId: string;
  if (defaultSupplier) {
    supplierId = defaultSupplier.id;
  } else {
    const [newSupplier] = await db
      .insert(suppliers)
      .values({
        organizationId: organizationId,
        name: "Default Supplier",
        contactEmail: null,
        contactPhone: null,
        orderingNotes: null,
        locationId: null,
      })
      .returning({ id: suppliers.id });
    if (!newSupplier) {
      throw new Error("Failed to create default supplier");
    }
    supplierId = newSupplier.id;
  }

  // Step 8: Create supplier parts with prices for all parts
  const allParts = await db
    .select({ id: partDefinitions.id, displayName: partDefinitions.displayName })
    .from(partDefinitions)
    .where(eq(partDefinitions.organizationId, organizationId));

  const packUomId = unitMap.get("ea");
  if (!packUomId) {
    throw new Error('Unit "ea" not found - required for supplier parts');
  }

  for (const part of allParts) {
    // Check if supplier part already exists
    const [existing] = await db
      .select()
      .from(supplierParts)
      .where(
        and(
          eq(supplierParts.partDefinitionId, part.id),
          eq(supplierParts.organizationId, organizationId),
          eq(supplierParts.supplierId, supplierId),
        ),
      )
      .limit(1);

    if (existing) {
      continue; // Skip if already exists
    }

    // Generate a price based on part type and size
    let basePrice = 500; // Default price in cents ($5.00)
    
    if (part.displayName.includes("Pipe")) {
      basePrice = 2000 + Math.floor(Math.random() * 5000); // $20-$70
    } else if (part.displayName.includes("Valve")) {
      basePrice = 1500 + Math.floor(Math.random() * 3500); // $15-$50
    } else if (
      part.displayName.includes("Elbow") ||
      part.displayName.includes("Tee")
    ) {
      basePrice = 300 + Math.floor(Math.random() * 1200); // $3-$15
    } else if (part.displayName.includes("Coupling") || part.displayName.includes("Coupler")) {
      basePrice = 200 + Math.floor(Math.random() * 800); // $2-$10
    } else if (part.displayName.includes("Faucet")) {
      basePrice = 5000 + Math.floor(Math.random() * 15000); // $50-$200
    } else if (part.displayName.includes("Sink")) {
      basePrice = 8000 + Math.floor(Math.random() * 20000); // $80-$280
    } else if (part.displayName.includes("Toilet")) {
      basePrice = 10000 + Math.floor(Math.random() * 25000); // $100-$350
    }

    // Adjust price based on size
    if (part.displayName.includes("3/4")) {
      basePrice = Math.floor(basePrice * 1.3);
    } else if (part.displayName.includes("1/2")) {
      basePrice = Math.floor(basePrice * 1.1);
    } else if (part.displayName.includes('1"')) {
      basePrice = Math.floor(basePrice * 1.5);
    }

    const priceString = (basePrice / 100).toFixed(2);
    const sku = part.displayName
      .replace(/[^a-zA-Z0-9]/g, "")
      .substring(0, 20)
      .toUpperCase();

    await db.insert(supplierParts).values({
      organizationId: organizationId,
      supplierId: supplierId,
      partDefinitionId: part.id,
      supplierSku: `${sku}-${Math.floor(Math.random() * 1000)}`,
      supplierName: part.displayName,
      packSize: "1",
      packUomId: packUomId,
      lastKnownUnitCost: priceString,
      currency: "CAD",
      isPreferred: true, // Set as preferred since it's the only supplier
      notes: null,
    });
  }
}
