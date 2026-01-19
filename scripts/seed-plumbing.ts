/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import "dotenv/config";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import {
  categories,
  locations,
  organizations,
  partDefinitions,
  partSynonyms,
  supplierParts,
  suppliers,
  units,
  jobs,
  materialLists,
  quotes,
  materials,
  sizes,
  partTypes,
} from "../src/server/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";
import { exec } from "child_process";
import { promisify } from "util";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";

const execAsync = promisify(exec);

// Lock file to prevent concurrent execution
const lockFile = join(process.cwd(), ".seed-lock");

function acquireLock() {
  if (existsSync(lockFile)) {
    console.error("❌ Another seed process is already running!");
    console.error(
      "   If you're sure no other process is running, delete .seed-lock and try again.",
    );
    process.exit(1);
  }
  writeFileSync(lockFile, process.pid.toString());
}

function releaseLock() {
  if (existsSync(lockFile)) {
    unlinkSync(lockFile);
  }
}

// Units to create
const unitDefinitions = [
  { code: "in", kind: "length", displayName: "Inch" },
  { code: "ft", kind: "length", displayName: "Foot" },
  { code: "mm", kind: "length", displayName: "Millimeter" },
  { code: "ea", kind: "count", displayName: "Each" },
];

// Category structure
const categoryStructure = [
  {
    name: "Fittings",
    children: [
      { name: "Elbows", sortOrder: 1 },
      { name: "Tees", sortOrder: 2 },
      { name: "Couplings", sortOrder: 3 },
      { name: "Adapters", sortOrder: 4 },
      { name: "Reducers", sortOrder: 5 },
    ],
  },
  {
    name: "Valves",
    children: [
      { name: "Ball Valves", sortOrder: 1 },
      { name: "Gate Valves", sortOrder: 2 },
      { name: "Check Valves", sortOrder: 3 },
      { name: "Pressure Relief Valves", sortOrder: 4 },
    ],
  },
  {
    name: "Pipes",
    children: [
      { name: "Copper Pipe", sortOrder: 1 },
      { name: "PVC Pipe", sortOrder: 2 },
      { name: "PEX Pipe", sortOrder: 3 },
      { name: "Galvanized Steel", sortOrder: 4 },
    ],
  },
  {
    name: "Tools",
    children: [
      { name: "Wrenches", sortOrder: 1 },
      { name: "Cutters", sortOrder: 2 },
      { name: "Threading Tools", sortOrder: 3 },
    ],
  },
];

// Part definitions
const partDefinitionsData = [
  {
    categoryName: "Elbows",
    displayName: "90° Copper Elbow",
    description: "90 degree copper elbow fitting for water lines",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["copper 90", "90 elbow", "copper elbow 90"],
  },
  {
    categoryName: "Elbows",
    displayName: "90° PVC Elbow",
    description: "90 degree PVC elbow fitting",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["PVC 90", "90 PVC elbow"],
  },
  {
    categoryName: "Elbows",
    displayName: "45° Copper Elbow",
    description: "45 degree copper elbow fitting",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["copper 45", "45 elbow"],
  },
  {
    categoryName: "Elbows",
    displayName: "90° PEX Elbow",
    description: "90 degree PEX elbow fitting",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "elbow",
    synonyms: ["PEX 90", "90 PEX elbow"],
  },
  {
    categoryName: "Tees",
    displayName: "Copper Tee",
    description: "Copper tee fitting for branch connections",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "tee",
    synonyms: ["copper tee", "T fitting", "copper T"],
  },
  {
    categoryName: "Tees",
    displayName: "PVC Tee",
    description: "PVC tee fitting",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "tee",
    synonyms: ["PVC tee", "PVC T"],
  },
  {
    categoryName: "Tees",
    displayName: "Reducing Tee",
    description: "Copper reducing tee fitting",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "tee",
    synonyms: ["reducing tee", "copper reducing tee"],
  },
  {
    categoryName: "Couplings",
    displayName: "Copper Coupling",
    description: "Straight copper coupling",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "coupling",
    synonyms: ["copper coupling", "straight coupling"],
  },
  {
    categoryName: "Couplings",
    displayName: "PVC Coupling",
    description: "PVC coupling for pipe connections",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "coupling",
    synonyms: ["PVC coupling"],
  },
  {
    categoryName: "Ball Valves",
    displayName: '1/2" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "ball valve",
    synonyms: ["ball valve", "quarter turn valve"],
  },
  {
    categoryName: "Ball Valves",
    displayName: '3/4" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "ball valve",
    synonyms: ["ball valve 3/4", "3/4 ball valve"],
  },
  {
    categoryName: "Gate Valves",
    displayName: '1/2" Gate Valve',
    description: "Gate valve for water shutoff",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "gate valve",
    synonyms: ["gate valve", "shutoff valve"],
  },
  {
    categoryName: "Check Valves",
    displayName: '1/2" Check Valve',
    description: "Check valve to prevent backflow",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "check valve",
    synonyms: ["check valve", "backflow preventer"],
  },
  {
    categoryName: "Copper Pipe",
    displayName: '1/2" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "type L copper",
    synonyms: ["copper pipe", "type L copper", "1/2 copper"],
  },
  {
    categoryName: "Copper Pipe",
    displayName: '3/4" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "type L copper",
    synonyms: ["copper pipe 3/4", "3/4 copper"],
  },
  {
    categoryName: "PVC Pipe",
    displayName: '3/4" PVC Schedule 40 Pipe',
    description: "PVC schedule 40 pipe, 10 foot length",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "schedule 40",
    synonyms: ["PVC pipe", "schedule 40 PVC", "3/4 PVC"],
  },
  {
    categoryName: "PEX Pipe",
    displayName: '1/2" PEX Pipe',
    description: "PEX pipe, 100 foot coil",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "PEX pipe",
    synonyms: ["PEX pipe", "1/2 PEX"],
  },
  {
    categoryName: "Wrenches",
    displayName: 'Pipe Wrench 12"',
    description: "Adjustable pipe wrench",
    material: "Steel",
    sizeNominal: 12,
    sizeUnit: "in",
    partType: "wrench",
    synonyms: ["pipe wrench", "12 inch wrench"],
  },
  {
    categoryName: "Cutters",
    displayName: "Copper Pipe Cutter",
    description: "Rotary pipe cutter for copper",
    material: "Steel",
    sizeNominal: null,
    sizeUnit: null,
    partType: "cutter",
    synonyms: ["pipe cutter", "copper cutter"],
  },
];

// Location definitions
const locationDefinitions = [
  {
    name: "Main Warehouse",
    address1: "123 Industrial Blvd",
    city: "Vancouver",
    region: "BC",
    postalCode: "V6B 1A1",
    country: "Canada",
  },
  {
    name: "Downtown Branch",
    address1: "456 Main Street",
    city: "Vancouver",
    region: "BC",
    postalCode: "V6B 2B2",
    country: "Canada",
  },
  {
    name: "East Side Distribution",
    address1: "789 Commerce Way",
    city: "Burnaby",
    region: "BC",
    postalCode: "V5C 3C3",
    country: "Canada",
  },
  {
    name: "North Shore Location",
    address1: "321 Marine Drive",
    city: "North Vancouver",
    region: "BC",
    postalCode: "V7M 4D4",
    country: "Canada",
  },
];

// Supplier definitions
const supplierDefinitions = [
  {
    name: "ABC Plumbing Supply",
    contactEmail: "orders@abcplumbing.com",
    contactPhone: "555-0100",
    orderingNotes: "Minimum order $100. Same-day delivery available.",
    locationName: "Main Warehouse",
  },
  {
    name: "Metro Hardware & Supply",
    contactEmail: "wholesale@metrohardware.com",
    contactPhone: "555-0200",
    orderingNotes: "Bulk pricing available. 2-3 day delivery.",
    locationName: "Downtown Branch",
  },
  {
    name: "Professional Plumbing Distributors",
    contactEmail: "sales@proplumbdist.com",
    contactPhone: "555-0300",
    orderingNotes:
      "Trade accounts only. Next-day delivery for orders before 2 PM.",
    locationName: "East Side Distribution",
  },
  {
    name: "Coastal Supply Co.",
    contactEmail: "info@coastalsupply.com",
    contactPhone: "555-0400",
    orderingNotes:
      "Free shipping on orders over $250. Extended warranty available.",
    locationName: "North Shore Location",
  },
];

async function ensureDatabaseExists() {
  console.log("🔍 Checking if database exists...");

  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL environment variable is not set. Please check your .env file.",
    );
  }

  const dbUrl = new URL(env.DATABASE_URL);
  const dbName = dbUrl.pathname.slice(1).split("?")[0];

  if (!dbName) {
    throw new Error(
      `No database name found in DATABASE_URL: ${env.DATABASE_URL}`,
    );
  }

  const adminUrl = env.DATABASE_URL.replace(`/${dbName}`, "/postgres").split(
    "?",
  )[0];

  if (!adminUrl) {
    throw new Error("Failed to construct admin database URL");
  }

  const adminConn = postgres(adminUrl, { max: 1 });

  try {
    const result = await adminConn.unsafe(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName],
    );

    if (!result || result.length === 0) {
      console.log(`📦 Creating database "${dbName}"...`);
      await adminConn.unsafe(`CREATE DATABASE "${dbName}";`);
      console.log(`✅ Database "${dbName}" created successfully!`);
    } else {
      console.log(`✓ Database "${dbName}" already exists`);
    }
  } finally {
    await adminConn.end();
  }

  console.log("✅ Database check complete");
}

async function runDbPush() {
  console.log("🔄 Pushing schema to database...");
  const { stdout, stderr } = await execAsync("pnpm db:push");
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
  console.log("✅ Schema pushed successfully!");
}

async function truncateTables(db: ReturnType<typeof drizzle>) {
  console.log(
    "\n🗑️  Truncating tables (preserving users and organizations)...",
  );

  try {
    // First, reset user foreign key references to prevent constraint violations
    console.log("   → Resetting user foreign key references...");
    try {
      await db.execute(
        sql.raw(
          `UPDATE kublai_user SET "currentJobId" = NULL, "pricingProfileId" = NULL;`,
        ),
      );
    } catch (err) {
      console.log("No kublai_user table detected, skipping user FK reset");
    }
    console.log("   ✓ User references reset");

    // List of tables to truncate (excluding user, organization, and NextAuth tables)
    const tablesToTruncate = [
      "kublai_quote_item",
      "kublai_order_item",
      "kublai_quote",
      "kublai_order",
      "kublai_material_list",
      "kublai_job_supplier",
      "kublai_job",
      "kublai_supplier_part",
      "kublai_part_attribute",
      "kublai_part_synonym",
      "kublai_part_definition",
      "kublai_supplier",
      "kublai_location",
      "kublai_pricing_profile",
      "kublai_category",
      "kublai_unit",
      "kublai_material",
      "kublai_size",
      "kublai_part_type",
    ];

    // Truncate tables with CASCADE to handle foreign key constraints
    for (const table of tablesToTruncate) {
      await db.execute(sql.raw(`TRUNCATE TABLE ${table} CASCADE;`));
      console.log(`   ✓ Truncated ${table}`);
    }

    console.log("✅ Table truncation complete");
  } catch (error) {
    console.error(
      "⚠️  Error during truncation (may be expected if tables are empty):",
      error,
    );
  }
}

async function main() {
  acquireLock();

  try {
    // Step 1: Ensure database exists
    await ensureDatabaseExists();

    // Step 2: Connect to database
    const connection = postgres(env.DATABASE_URL);
    const db = drizzle(connection);

    try {
      // Step 3: Truncate existing data (except users and organizations)
      await truncateTables(db);

      // Step 4: Create units (must be first - no dependencies)
      console.log("\n📏 Creating units...");
      const unitMap = new Map<string, string>();
      for (const unitDef of unitDefinitions) {
        const [unit] = await db
          .insert(units)
          .values(unitDef)
          .onConflictDoNothing()
          .returning({ id: units.id });
        if (unit) {
          unitMap.set(unitDef.code, unit.id);
          console.log(`   ✓ Created unit "${unitDef.code}"`);
        } else {
          // Already exists, fetch it
          const [existing] = await db
            .select()
            .from(units)
            .where(eq(units.code, unitDef.code))
            .limit(1);
          if (existing) {
            unitMap.set(unitDef.code, existing.id);
            console.log(`   ✓ Unit "${unitDef.code}" already exists`);
          }
        }
      }

      // Step 5: Create organization (needed for materials, partTypes, and parts)
      console.log("\n🏢 Creating organization...");
      const orgName = "Seed Test Organization";
      const [org] = await db
        .insert(organizations)
        .values({ name: orgName })
        .onConflictDoNothing()
        .returning({ id: organizations.id });

      let organizationId: string;
      if (org) {
        organizationId = org.id;
        console.log(`   ✓ Created organization "${orgName}"`);
      } else {
        const [existing] = await db
          .select()
          .from(organizations)
          .where(eq(organizations.name, orgName))
          .limit(1);
        if (!existing) {
          throw new Error(`Failed to create/find organization ${orgName}`);
        }
        organizationId = existing.id;
        console.log(`   ✓ Organization "${orgName}" already exists`);
      }

      // Step 6: Create categories (parents first, then children, linked to organization)
      console.log("\n📁 Creating categories...");
      const categoryMap = new Map<string, string>();

      // Create parent categories first
      for (const parentCat of categoryStructure) {
        const [parent] = await db
          .insert(categories)
          .values({
            name: parentCat.name,
            organizationId: organizationId,
            parentId: null,
            sortOrder: 0,
          })
          .onConflictDoNothing()
          .returning({ id: categories.id });

        let parentId: string;
        if (parent) {
          parentId = parent.id;
          console.log(`   ✓ Created category "${parentCat.name}"`);
        } else {
          const [existing] = await db
            .select()
            .from(categories)
            .where(
              and(
                eq(categories.name, parentCat.name),
                eq(categories.organizationId, organizationId),
                isNull(categories.parentId),
              ),
            )
            .limit(1);
          if (!existing) {
            throw new Error(`Failed to create/find category ${parentCat.name}`);
          }
          parentId = existing.id;
          console.log(`   ✓ Category "${parentCat.name}" already exists`);
        }

        categoryMap.set(parentCat.name, parentId);

        // Create child categories
        for (const childCat of parentCat.children) {
          const [child] = await db
            .insert(categories)
            .values({
              name: childCat.name,
              organizationId: organizationId,
              parentId: parentId,
              sortOrder: childCat.sortOrder,
            })
            .onConflictDoNothing()
            .returning({ id: categories.id });

          let childId: string;
          if (child) {
            childId = child.id;
            console.log(
              `   ✓ Created category "${parentCat.name} > ${childCat.name}"`,
            );
          } else {
            const [existing] = await db
              .select()
              .from(categories)
              .where(
                and(
                  eq(categories.name, childCat.name),
                  eq(categories.organizationId, organizationId),
                  eq(categories.parentId, parentId),
                ),
              )
              .limit(1);
            if (!existing) {
              throw new Error(
                `Failed to create/find category ${childCat.name}`,
              );
            }
            childId = existing.id;
            console.log(
              `   ✓ Category "${parentCat.name} > ${childCat.name}" already exists`,
            );
          }
          categoryMap.set(childCat.name, childId);
        }
      }

      // Step 7: Create materials (org-specific, before parts)
      console.log("\n🎨 Creating materials...");
      const materialSet = new Set<string>();
      for (const partData of partDefinitionsData) {
        if (partData.material) {
          materialSet.add(partData.material);
        }
      }
      const materialMap = new Map<string, string>();
      for (const materialName of Array.from(materialSet)) {
        const [material] = await db
          .insert(materials)
          .values({
            organizationId: organizationId,
            name: materialName,
          })
          .onConflictDoNothing()
          .returning({ id: materials.id });

        if (material) {
          materialMap.set(materialName, material.id);
          console.log(`   ✓ Created material "${materialName}"`);
        } else {
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
            console.log(`   ✓ Material "${materialName}" already exists`);
          }
        }
      }

      // Step 8: Create part types (org-specific, before parts)
      console.log("\n🔧 Creating part types...");
      const partTypeSet = new Set<string>();
      for (const partData of partDefinitionsData) {
        if (partData.partType) {
          partTypeSet.add(partData.partType);
        }
      }
      const partTypeMap = new Map<string, string>();
      for (const partTypeName of Array.from(partTypeSet)) {
        const [partType] = await db
          .insert(partTypes)
          .values({
            organizationId: organizationId,
            name: partTypeName,
          })
          .onConflictDoNothing()
          .returning({ id: partTypes.id });

        if (partType) {
          partTypeMap.set(partTypeName, partType.id);
          console.log(`   ✓ Created part type "${partTypeName}"`);
        } else {
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
            console.log(`   ✓ Part type "${partTypeName}" already exists`);
          }
        }
      }

      // Step 9: Create sizes and build sizeMap (must be before creating parts)
      console.log("\n📐 Creating sizes...");
      const sizeSet = new Set<string>();
      for (const partData of partDefinitionsData) {
        if (
          partData.sizeNominal !== null &&
          partData.sizeNominal !== undefined &&
          partData.sizeUnit
        ) {
          const sizeKey = `${partData.sizeNominal}_${partData.sizeUnit}`;
          sizeSet.add(sizeKey);
        }
      }

      // Add sizes from sizesList
      const sizesList = [
        { nominal: 0.5, unitCode: "in" },
        { nominal: 0.75, unitCode: "in" },
        { nominal: 1.0, unitCode: "in" },
        { nominal: 12, unitCode: "in" },
      ];
      for (const sizeData of sizesList) {
        const sizeKey = `${sizeData.nominal}_${sizeData.unitCode}`;
        sizeSet.add(sizeKey);
      }

      const sizeMap = new Map<string, string>();
      let sizesCreated = 0;

      // Create or find all sizes and build the map
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
          console.log(`   ✓ Size ${nominal} ${unitCode} already exists`);
        } else {
          const [size] = await db
            .insert(sizes)
            .values({
              organizationId: organizationId,
              nominal: nominal.toString(),
              unitId: unitId,
            })
            .onConflictDoNothing()
            .returning({ id: sizes.id });

          if (size) {
            sizesCreated++;
            sizeMap.set(sizeKey, size.id);
            console.log(`   ✓ Created size ${nominal} ${unitCode}`);
          }
        }
      }

      // Step 10: Create parts
      console.log("\n🔩 Creating part definitions...");
      let partsCreated = 0;
      let synonymsCreated = 0;

      for (const partData of partDefinitionsData) {
        const categoryId = categoryMap.get(partData.categoryName);
        if (!categoryId) {
          throw new Error(
            `Category "${partData.categoryName}" not found in categoryMap`,
          );
        }

        // Get sizeId from sizeMap (created in Step 11)
        const sizeKey =
          partData.sizeNominal !== null &&
          partData.sizeNominal !== undefined &&
          partData.sizeUnit
            ? `${partData.sizeNominal}_${partData.sizeUnit}`
            : null;
        let sizeId = sizeKey ? sizeMap.get(sizeKey) ?? null : null;

        // If no sizeId found but we have size data, create it
        if (!sizeId && sizeKey) {
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
                sizeId = newSize.id;
                sizeMap.set(sizeKey, newSize.id);
              }
            }
          }
        }

        // If still no sizeId, create a default "no size" size
        if (!sizeId) {
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
          sizeId = defaultSizeId ?? null;
        }

        if (!sizeId) {
          console.warn(
            `Failed to get or create size for part "${partData.displayName}"`,
          );
          continue;
        }

        const defaultUomId = unitMap.get("ea");
        if (!defaultUomId) {
          throw new Error('Unit "ea" not found - required for default UOM');
        }

        const materialId = partData.material
          ? (materialMap.get(partData.material) ?? null)
          : null;
        if (partData.material && !materialId) {
          console.warn(
            `   ⚠️  Warning: Material "${partData.material}" not found in materialMap for part "${partData.displayName}"`,
          );
        }

        const partTypeId = partData.partType
          ? (partTypeMap.get(partData.partType) ?? null)
          : null;
        if (partData.partType && !partTypeId) {
          console.warn(
            `   ⚠️  Warning: PartType "${partData.partType}" not found in partTypeMap for part "${partData.displayName}"`,
          );
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
            sizeId: sizeId,
            defaultUomId: defaultUomId,
            isActive: true,
          })
          .onConflictDoNothing()
          .returning({ id: partDefinitions.id });

        let partId: string;
        if (part) {
          partId = part.id;
          partsCreated++;
          console.log(`   ✓ Created part "${partData.displayName}"`);
        } else {
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
          if (!existing) {
            throw new Error(
              `Failed to create/find part ${partData.displayName}`,
            );
          }
          partId = existing.id;
          console.log(`   ✓ Part "${partData.displayName}" already exists`);
        }

        // Create synonyms
        for (const synonym of partData.synonyms) {
          await db
            .insert(partSynonyms)
            .values({
              partDefinitionId: partId,
              synonym: synonym,
            })
            .onConflictDoNothing();
          synonymsCreated++;
        }
      }

      // Step 11: Create custom materials (org-specific, additional ones)
      console.log("\n🎨 Creating custom materials (org-specific)...");
      const materialsList = ["Copper", "PVC", "PEX", "Brass", "Steel"];
      let materialsCreated = 0;

      for (const materialName of materialsList) {
        const [material] = await db
          .insert(materials)
          .values({
            organizationId: organizationId,
            name: materialName,
          })
          .onConflictDoNothing()
          .returning({ id: materials.id });

        if (material) {
          materialsCreated++;
          console.log(`   ✓ Created material "${materialName}"`);
        } else {
          console.log(`   ✓ Material "${materialName}" already exists`);
        }
      }

      // Step 12: Create custom part types (org-specific, additional ones)
      console.log("\n🔧 Creating custom part types (org-specific)...");
      const partTypesList = [
        "elbow",
        "tee",
        "coupling",
        "ball valve",
        "gate valve",
        "check valve",
        "type L copper",
        "schedule 40",
        "PEX pipe",
        "wrench",
        "cutter",
      ];
      let partTypesCreated = 0;

      for (const partTypeName of partTypesList) {
        const [partType] = await db
          .insert(partTypes)
          .values({
            organizationId: organizationId,
            name: partTypeName,
          })
          .onConflictDoNothing()
          .returning({ id: partTypes.id });

        if (partType) {
          partTypesCreated++;
          console.log(`   ✓ Created part type "${partTypeName}"`);
        } else {
          console.log(`   ✓ Part type "${partTypeName}" already exists`);
        }
      }

      // Step 13: Create locations
      console.log("\n📍 Creating locations...");
      const locationMap = new Map<string, string>();
      let locationsCreated = 0;

      for (const locationData of locationDefinitions) {
        const [location] = await db
          .insert(locations)
          .values({
            organizationId: organizationId,
            name: locationData.name,
            address1: locationData.address1,
            address2: null,
            city: locationData.city,
            region: locationData.region,
            postalCode: locationData.postalCode,
            country: locationData.country,
            notes: null,
          })
          .onConflictDoNothing()
          .returning({ id: locations.id });

        let locationId: string;
        if (location) {
          locationId = location.id;
          locationMap.set(locationData.name, locationId);
          locationsCreated++;
          console.log(`   ✓ Created location "${locationData.name}"`);
        } else {
          const [existing] = await db
            .select()
            .from(locations)
            .where(
              and(
                eq(locations.name, locationData.name),
                eq(locations.organizationId, organizationId),
              ),
            )
            .limit(1);
          if (!existing) {
            throw new Error(
              `Failed to create/find location ${locationData.name}`,
            );
          }
          locationId = existing.id;
          locationMap.set(locationData.name, locationId);
          console.log(`   ✓ Location "${locationData.name}" already exists`);
        }
      }

      // Step 14: Create suppliers
      console.log("\n🏪 Creating suppliers...");
      let suppliersCreated = 0;
      const supplierIds: string[] = [];

      for (const supplierData of supplierDefinitions) {
        const locationId = locationMap.get(supplierData.locationName) ?? null;

        const [supplier] = await db
          .insert(suppliers)
          .values({
            organizationId: organizationId,
            name: supplierData.name,
            contactEmail: supplierData.contactEmail,
            contactPhone: supplierData.contactPhone,
            orderingNotes: supplierData.orderingNotes,
            locationId: locationId,
          })
          .onConflictDoNothing()
          .returning({ id: suppliers.id });

        let supplierId: string;
        if (supplier) {
          supplierId = supplier.id;
          supplierIds.push(supplierId);
          suppliersCreated++;
          console.log(`   ✓ Created supplier "${supplierData.name}"`);
        } else {
          const [existing] = await db
            .select()
            .from(suppliers)
            .where(
              and(
                eq(suppliers.name, supplierData.name),
                eq(suppliers.organizationId, organizationId),
              ),
            )
            .limit(1);
          if (!existing) {
            throw new Error(
              `Failed to create/find supplier ${supplierData.name}`,
            );
          }
          supplierId = existing.id;
          supplierIds.push(supplierId);
          console.log(`   ✓ Supplier "${supplierData.name}" already exists`);
        }
      }

      // Step 15: Link parts to suppliers
      console.log("\n🔗 Linking parts to suppliers...");
      let supplierPartsCreated = 0;

      if (!organizationId) {
        throw new Error("Organization ID is not defined");
      }

      const allParts = await db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
        })
        .from(partDefinitions)
        .where(eq(partDefinitions.organizationId, organizationId));

      for (const part of allParts) {
        const existingSupplierParts = await db
          .select()
          .from(supplierParts)
          .where(
            and(
              eq(supplierParts.partDefinitionId, part.id),
              eq(supplierParts.organizationId, organizationId),
            ),
          )
          .limit(1);

        if (existingSupplierParts.length === 0 && supplierIds.length > 0) {
          const randomSupplierId =
            supplierIds[Math.floor(Math.random() * supplierIds.length)];

          if (!randomSupplierId) {
            continue;
          }

          const sku = part.displayName
            .replace(/[^a-zA-Z0-9]/g, "")
            .substring(0, 20)
            .toUpperCase();

          let basePrice = 500;
          if (part.displayName.includes("Pipe")) {
            basePrice = 2000 + Math.floor(Math.random() * 5000);
          } else if (part.displayName.includes("Valve")) {
            basePrice = 1500 + Math.floor(Math.random() * 3500);
          } else if (
            part.displayName.includes("Elbow") ||
            part.displayName.includes("Tee")
          ) {
            basePrice = 300 + Math.floor(Math.random() * 1200);
          } else if (part.displayName.includes("Coupling")) {
            basePrice = 200 + Math.floor(Math.random() * 800);
          } else if (
            part.displayName.includes("Wrench") ||
            part.displayName.includes("Cutter")
          ) {
            basePrice = 3000 + Math.floor(Math.random() * 7000);
          }

          if (part.displayName.includes("3/4")) {
            basePrice = Math.floor(basePrice * 1.3);
          } else if (part.displayName.includes("1/2")) {
            basePrice = Math.floor(basePrice * 1.1);
          }

          const priceString = (basePrice / 100).toFixed(2);
          const packUomId = unitMap.get("ea");

          await db.insert(supplierParts).values({
            organizationId: organizationId,
            supplierId: randomSupplierId,
            partDefinitionId: part.id,
            supplierSku: `${sku}-${Math.floor(Math.random() * 1000)}`,
            supplierName: part.displayName,
            packSize: "1",
            packUomId: packUomId ?? null,
            lastKnownUnitCost: priceString,
            currency: "CAD",
            isPreferred: false,
            notes: null,
          });

          supplierPartsCreated++;
        }
      }

      console.log(`   ✓ Linked ${supplierPartsCreated} parts to suppliers`);

      // Step 16: Create sample job and material list
      console.log("\n📋 Creating sample job and material list...");
      const [sampleJob] = await db
        .insert(jobs)
        .values({
          organizationId: organizationId,
          name: "Sample Plumbing Job",
          createdByUserId: null, // No user in seed script
          status: "draft",
        })
        .onConflictDoNothing()
        .returning();

      let jobId: string | undefined;
      if (sampleJob) {
        jobId = sampleJob.id;
        console.log(`   ✓ Created sample job "${sampleJob.name}"`);
      } else {
        // Job already exists, fetch it
        const [existing] = await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.organizationId, organizationId),
              eq(jobs.name, "Sample Plumbing Job"),
            ),
          )
          .limit(1);
        if (existing) {
          jobId = existing.id;
          console.log(`   ✓ Sample job already exists`);
        }
      }

      if (jobId) {
        // Create sample material list
        const [sampleMaterialList] = await db
          .insert(materialLists)
          .values({
            organizationId: organizationId,
            jobId: jobId,
            name: "Sample Material List",
            createdByUserId: null,
          })
          .onConflictDoNothing()
          .returning();

        if (sampleMaterialList) {
          // Create sample quote for material list
          const [sampleQuote] = await db
            .insert(quotes)
            .values({
              organizationId: organizationId,
              materialListId: sampleMaterialList.id,
              jobId: jobId,
              subtotalMaterials: "0",
              total: "0",
            })
            .returning();

          if (sampleQuote) {
            // Update material list with quote ID
            await db
              .update(materialLists)
              .set({ quoteId: sampleQuote.id })
              .where(eq(materialLists.id, sampleMaterialList.id));

            console.log(`   ✓ Created sample material list and quote`);
          }
        } else {
          console.log(`   ✓ Sample material list already exists`);
        }
      }

      // Summary
      console.log(`\n🎉 Plumbing seed completed successfully!`);
      console.log(`📊 Summary:`);
      console.log(`   - Units: ${unitMap.size}`);
      console.log(`   - Categories: ${categoryMap.size}`);
      console.log(`   - Global materials: ${materialMap.size}`);
      console.log(`   - Global part types: ${partTypeMap.size}`);
      console.log(`   - Parts created: ${partsCreated}`);
      console.log(`   - Synonyms created: ${synonymsCreated}`);
      console.log(`   - Org-specific materials created: ${materialsCreated}`);
      console.log(`   - Sizes created: ${sizesCreated}`);
      console.log(`   - Org-specific part types created: ${partTypesCreated}`);
      console.log(`   - Locations created: ${locationsCreated}`);
      console.log(`   - Suppliers created: ${suppliersCreated}`);
      console.log(`   - Supplier parts linked: ${supplierPartsCreated}`);
    } finally {
      await connection.end();
    }
  } catch (error) {
    console.error("❌ Seed script failed:", error);
    process.exit(1);
  } finally {
    releaseLock();
  }
}

void main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  })
  .finally(() => {
    releaseLock();
  });
