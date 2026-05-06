/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import "dotenv/config";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import {
  categories,
  catalogs,
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
    synonyms: ["copper 90", "90 elbow", "copper elbow 90"],
  },
  {
    categoryName: "Elbows",
    displayName: "90° PVC Elbow",
    description: "90 degree PVC elbow fitting",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    synonyms: ["PVC 90", "90 PVC elbow"],
  },
  {
    categoryName: "Elbows",
    displayName: "45° Copper Elbow",
    description: "45 degree copper elbow fitting",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["copper 45", "45 elbow"],
  },
  {
    categoryName: "Elbows",
    displayName: "90° PEX Elbow",
    description: "90 degree PEX elbow fitting",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["PEX 90", "90 PEX elbow"],
  },
  {
    categoryName: "Tees",
    displayName: "Copper Tee",
    description: "Copper tee fitting for branch connections",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["copper tee", "T fitting", "copper T"],
  },
  {
    categoryName: "Tees",
    displayName: "PVC Tee",
    description: "PVC tee fitting",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    synonyms: ["PVC tee", "PVC T"],
  },
  {
    categoryName: "Tees",
    displayName: "Reducing Tee",
    description: "Copper reducing tee fitting",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    synonyms: ["reducing tee", "copper reducing tee"],
  },
  {
    categoryName: "Couplings",
    displayName: "Copper Coupling",
    description: "Straight copper coupling",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["copper coupling", "straight coupling"],
  },
  {
    categoryName: "Couplings",
    displayName: "PVC Coupling",
    description: "PVC coupling for pipe connections",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    synonyms: ["PVC coupling"],
  },
  {
    categoryName: "Ball Valves",
    displayName: '1/2" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["ball valve", "quarter turn valve"],
  },
  {
    categoryName: "Ball Valves",
    displayName: '3/4" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.75,
    sizeUnit: "in",
    synonyms: ["ball valve 3/4", "3/4 ball valve"],
  },
  {
    categoryName: "Gate Valves",
    displayName: '1/2" Gate Valve',
    description: "Gate valve for water shutoff",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["gate valve", "shutoff valve"],
  },
  {
    categoryName: "Check Valves",
    displayName: '1/2" Check Valve',
    description: "Check valve to prevent backflow",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["check valve", "backflow preventer"],
  },
  {
    categoryName: "Copper Pipe",
    displayName: '1/2" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["copper pipe", "type L copper", "1/2 copper"],
  },
  {
    categoryName: "Copper Pipe",
    displayName: '3/4" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    synonyms: ["copper pipe 3/4", "3/4 copper"],
  },
  {
    categoryName: "PVC Pipe",
    displayName: '3/4" PVC Schedule 40 Pipe',
    description: "PVC schedule 40 pipe, 10 foot length",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    synonyms: ["PVC pipe", "schedule 40 PVC", "3/4 PVC"],
  },
  {
    categoryName: "PEX Pipe",
    displayName: '1/2" PEX Pipe',
    description: "PEX pipe, 100 foot coil",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    synonyms: ["PEX pipe", "1/2 PEX"],
  },
  {
    categoryName: "Wrenches",
    displayName: 'Pipe Wrench 12"',
    description: "Adjustable pipe wrench",
    material: "Steel",
    sizeNominal: 12,
    sizeUnit: "in",
    synonyms: ["pipe wrench", "12 inch wrench"],
  },
  {
    categoryName: "Cutters",
    displayName: "Copper Pipe Cutter",
    description: "Rotary pipe cutter for copper",
    material: "Steel",
    sizeNominal: null,
    sizeUnit: null,
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

      // Step 5: Create organization (needed for materials and parts)
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

      // Step 6: Create Plumbing catalog and categories
      console.log("\n📚 Creating Plumbing catalog...");
      const [createdDefaultCatalog] = await db
        .insert(catalogs)
        .values({
          name: "Plumbing",
          organizationId: organizationId,
          sortOrder: 0,
        })
        .onConflictDoNothing()
        .returning({ id: catalogs.id });

      let defaultCatalogId: string;
      if (createdDefaultCatalog) {
        defaultCatalogId = createdDefaultCatalog.id;
        console.log('   ✓ Created catalog "Plumbing"');
      } else {
        const [existingDefaultCatalog] = await db
          .select()
          .from(catalogs)
          .where(
            and(
              eq(catalogs.name, "Plumbing"),
              eq(catalogs.organizationId, organizationId),
            ),
          )
          .limit(1);
        if (!existingDefaultCatalog) {
          throw new Error('Failed to create/find catalog "Plumbing"');
        }
        defaultCatalogId = existingDefaultCatalog.id;
        console.log('   ✓ Catalog "Plumbing" already exists');
      }

      console.log("\n📁 Creating categories...");
      const categoryMap = new Map<string, string>();

      // Create parent categories first
      for (const parentCat of categoryStructure) {
        const [parent] = await db
          .insert(categories)
          .values({
            name: parentCat.name,
            organizationId: organizationId,
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

      // Step 8: Create sizes and build sizeMap (must be before creating parts)
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

        const materialId = partData.material
          ? (materialMap.get(partData.material) ?? null)
          : null;
        if (partData.material && !materialId) {
          console.warn(
            `   ⚠️  Warning: Material "${partData.material}" not found in materialMap for part "${partData.displayName}"`,
          );
        }

    const [part] = await db
          .insert(partDefinitions)
          .values({
            organizationId: organizationId,
            catalogId: defaultCatalogId,
            categoryId: categoryId,
            displayName: partData.displayName,
            description: partData.description,
            imageUrl: null,
                materialId: materialId,
            sizeId: sizeId,
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
