import "dotenv/config";
import { db } from "../src/server/db";
import {
  categories,
  locations,
  organizations,
  partDefinitions,
  partSynonyms,
  supplierParts,
  suppliers,
  units,
} from "../src/server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { exec } from "child_process";
import { promisify } from "util";
import { clearDatabase } from "./clear-db";
import { sql } from "drizzle-orm";

const execAsync = promisify(exec);

/**
 * Seed script to populate the database with plumbing categories, parts, and suppliers
 *
 * Creates:
 * - Units (in, ft, mm, etc.)
 * - Plumbing categories (Fittings, Valves, Pipes, Tools, etc.)
 * - Sample parts with materials, sizes, and synonyms
 * - Suppliers (plumbing supply companies)
 *
 * This script is upsert-friendly - it can be run multiple times safely.
 * Run with: pnpm tsx scripts/seed-plumbing.ts
 */

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

// Part definitions with realistic plumbing data
const partDefinitionsData = [
  // Elbows
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
  // Tees
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
  // Couplings
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
  // Valves
  {
    categoryName: "Ball Valves",
    displayName: '1/2" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "valve",
    synonyms: ["ball valve", "quarter turn valve"],
  },
  {
    categoryName: "Ball Valves",
    displayName: '3/4" Ball Valve',
    description: "Quarter turn ball valve",
    material: "Brass",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "valve",
    synonyms: ["ball valve 3/4", "3/4 ball valve"],
  },
  {
    categoryName: "Gate Valves",
    displayName: '1/2" Gate Valve',
    description: "Gate valve for water shutoff",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "valve",
    synonyms: ["gate valve", "shutoff valve"],
  },
  {
    categoryName: "Check Valves",
    displayName: '1/2" Check Valve',
    description: "Check valve to prevent backflow",
    material: "Brass",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "valve",
    synonyms: ["check valve", "backflow preventer"],
  },
  // Pipes
  {
    categoryName: "Copper Pipe",
    displayName: '1/2" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "pipe",
    synonyms: ["copper pipe", "type L copper", "1/2 copper"],
  },
  {
    categoryName: "Copper Pipe",
    displayName: '3/4" Type L Copper Pipe',
    description: "Type L copper pipe, 10 foot length",
    material: "Copper",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "pipe",
    synonyms: ["copper pipe 3/4", "3/4 copper"],
  },
  {
    categoryName: "PVC Pipe",
    displayName: '3/4" PVC Schedule 40 Pipe',
    description: "PVC schedule 40 pipe, 10 foot length",
    material: "PVC",
    sizeNominal: 0.75,
    sizeUnit: "in",
    partType: "pipe",
    synonyms: ["PVC pipe", "schedule 40 PVC", "3/4 PVC"],
  },
  {
    categoryName: "PEX Pipe",
    displayName: '1/2" PEX Pipe',
    description: "PEX pipe, 100 foot coil",
    material: "PEX",
    sizeNominal: 0.5,
    sizeUnit: "in",
    partType: "pipe",
    synonyms: ["PEX pipe", "1/2 PEX"],
  },
  // Tools
  {
    categoryName: "Wrenches",
    displayName: 'Pipe Wrench 12"',
    description: "Adjustable pipe wrench",
    material: "Steel",
    sizeNominal: 12,
    sizeUnit: "in",
    partType: "tool",
    synonyms: ["pipe wrench", "12 inch wrench"],
  },
  {
    categoryName: "Cutters",
    displayName: "Copper Pipe Cutter",
    description: "Rotary pipe cutter for copper",
    material: "Steel",
    sizeNominal: null,
    sizeUnit: null,
    partType: "tool",
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

// Supplier definitions with location assignments
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

async function runMigrations() {
  console.log("🔄 Running database migrations...");
  try {
    let { stdout, stderr } = await execAsync("pnpm db:migrate");
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    ({ stdout, stderr } = await execAsync("pnpm db:push"));
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    console.log("✅ Migrations completed successfully!");
  } catch (error) {
    console.error("❌ Error running migrations:", error);
    throw error;
  }
}

async function seedPlumbing(
  shouldClearFirst = false,
  shouldRunMigrations = false,
) {
  console.log("🔧 Starting plumbing parts seed...");

  try {
    // Optionally clear the entire database first (full schema drop)
    if (shouldClearFirst) {
      console.log("🗑️  Clearing entire database...");
      await clearDatabase(db as any);
      console.log("✅ Database cleared successfully!");
    }

    // Run migrations if requested (always needed after clearing, or if explicitly requested)
    if (shouldRunMigrations || shouldClearFirst) {
      console.log("Running migrations...");
      await runMigrations();
    }

    // Clear existing plumbing seed data in correct order (respecting foreign key constraints)
    // Skip if we just cleared the entire database (tables don't exist yet)
    if (!shouldClearFirst) {
      console.log("🗑️  Clearing existing plumbing seed data...");
      // Use raw SQL to avoid import issues and respect foreign key constraints
      // Delete in order: supplier_parts -> part_synonyms -> part_definitions -> suppliers -> locations -> categories -> units
      await db.execute(sql`DELETE FROM kublai_supplier_part`);
      await db.execute(sql`DELETE FROM kublai_part_synonym`);
      await db.execute(
        sql`DELETE FROM kublai_part_definition WHERE "organizationId" IS NULL`,
      );
      await db.execute(sql`DELETE FROM kublai_supplier`);
      await db.execute(sql`DELETE FROM kublai_location`);
      await db.execute(
        sql`DELETE FROM kublai_category WHERE "organizationId" IS NULL`,
      );
      await db.execute(sql`DELETE FROM kublai_unit`);
      // Note: We don't delete organizations here as they might be used by other parts of the system
      // Only delete the seed test organization if it exists
      await db.execute(
        sql`DELETE FROM kublai_organization WHERE name = 'Seed Test Organization'`,
      );
      console.log("✅ Cleared all existing plumbing seed data");
    }
    // Step 1: Create or get units
    console.log("📏 Creating units...");
    const unitMap = new Map<string, string>();

    for (const unitDef of unitDefinitions) {
      const [existing] = await db
        .select()
        .from(units)
        .where(eq(units.code, unitDef.code))
        .limit(1);

      if (existing) {
        unitMap.set(unitDef.code, existing.id);
        console.log(`   ✓ Unit "${unitDef.code}" already exists`);
      } else {
        const [newUnit] = await db
          .insert(units)
          .values(unitDef)
          .returning({ id: units.id });
        if (newUnit) {
          unitMap.set(unitDef.code, newUnit.id);
          console.log(`   ✓ Created unit "${unitDef.code}"`);
        }
      }
    }

    // Step 2: Create categories (global - organizationId = null)
    console.log("\n📁 Creating categories...");
    const categoryMap = new Map<string, string>();

    for (const parentCat of categoryStructure) {
      // Create parent category
      const [existingParent] = await db
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.name, parentCat.name),
            isNull(categories.organizationId),
          ),
        )
        .limit(1);

      let parentId: string;
      if (existingParent) {
        parentId = existingParent.id;
        console.log(`   ✓ Category "${parentCat.name}" already exists`);
      } else {
        const [newParent] = await db
          .insert(categories)
          .values({
            name: parentCat.name,
            organizationId: null,
            parentId: null,
            sortOrder: 0,
          })
          .returning({ id: categories.id });
        if (newParent) {
          parentId = newParent.id;
          console.log(`   ✓ Created category "${parentCat.name}"`);
        } else {
          throw new Error(`Failed to create category ${parentCat.name}`);
        }
      }

      categoryMap.set(parentCat.name, parentId);

      // Create child categories
      for (const childCat of parentCat.children) {
        const fullName = `${parentCat.name} > ${childCat.name}`;
        const [existingChild] = await db
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.name, childCat.name),
              isNull(categories.organizationId),
              eq(categories.parentId, parentId),
            ),
          )
          .limit(1);

        let childCategoryId: string;
        if (existingChild) {
          childCategoryId = existingChild.id;
          console.log(`   ✓ Category "${fullName}" already exists`);
        } else {
          const [newChild] = await db
            .insert(categories)
            .values({
              name: childCat.name,
              organizationId: null,
              parentId: parentId,
              sortOrder: childCat.sortOrder,
            })
            .returning({ id: categories.id });
          if (newChild) {
            childCategoryId = newChild.id;
            console.log(`   ✓ Created category "${fullName}"`);
          } else {
            throw new Error(`Failed to create category ${fullName}`);
          }
        }
        categoryMap.set(childCat.name, childCategoryId);
      }
    }

    // Step 3: Create part definitions
    console.log("\n🔩 Creating part definitions...");
    let partsCreated = 0;
    let synonymsCreated = 0;

    for (const partData of partDefinitionsData) {
      const categoryId = categoryMap.get(partData.categoryName);
      if (!categoryId) {
        console.warn(
          `   ⚠️  Category "${partData.categoryName}" not found, skipping part`,
        );
        continue;
      }

      const sizeUnitId = partData.sizeUnit
        ? unitMap.get(partData.sizeUnit)
        : null;
      const defaultUomId = unitMap.get("ea") ?? null;

      // Check if part already exists
      const [existing] = await db
        .select()
        .from(partDefinitions)
        .where(
          and(
            eq(partDefinitions.displayName, partData.displayName),
            isNull(partDefinitions.organizationId),
          ),
        )
        .limit(1);

      let partId: string;
      if (existing) {
        partId = existing.id;
        console.log(`   ✓ Part "${partData.displayName}" already exists`);
      } else {
        const [newPart] = await db
          .insert(partDefinitions)
          .values({
            organizationId: null, // Global parts
            categoryId: categoryId,
            displayName: partData.displayName,
            description: partData.description,
            imageUrl: null, // Can be added later
            partType: partData.partType,
            material: partData.material,
            sizeNominal: partData.sizeNominal,
            sizeUnitId: sizeUnitId,
            defaultUomId: defaultUomId,
            isActive: true,
          })
          .returning({ id: partDefinitions.id });

        if (newPart) {
          partId = newPart.id;
          partsCreated++;
          console.log(`   ✓ Created part "${partData.displayName}"`);
        } else {
          console.warn(
            `   ⚠️  Failed to create part "${partData.displayName}"`,
          );
          continue;
        }
      }

      // Create synonyms
      for (const synonym of partData.synonyms) {
        const [existingSynonym] = await db
          .select()
          .from(partSynonyms)
          .where(
            and(
              eq(partSynonyms.partDefinitionId, partId),
              eq(partSynonyms.synonym, synonym),
            ),
          )
          .limit(1);

        if (!existingSynonym) {
          await db.insert(partSynonyms).values({
            partDefinitionId: partId,
            synonym: synonym,
          });
          synonymsCreated++;
        }
      }
    }

    // Step 4: Create or get test organization for suppliers
    console.log("\n🏢 Setting up organization for suppliers...");
    const orgName = "Seed Test Organization";
    const [existingOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.name, orgName))
      .limit(1);

    let organizationId: string;
    if (existingOrg) {
      organizationId = existingOrg.id;
      console.log(`   ✓ Organization "${orgName}" already exists`);
    } else {
      const [newOrg] = await db
        .insert(organizations)
        .values({
          name: orgName,
        })
        .returning({ id: organizations.id });
      if (newOrg) {
        organizationId = newOrg.id;
        console.log(`   ✓ Created organization "${orgName}"`);
      } else {
        throw new Error("Failed to create organization");
      }
    }

    // Step 4.5: Create locations
    console.log("\n📍 Creating locations...");
    const locationMap = new Map<string, string>();
    let locationsCreated = 0;

    for (const locationData of locationDefinitions) {
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

      let locationId: string;
      if (existing) {
        locationId = existing.id;
        locationMap.set(locationData.name, locationId);
        console.log(`   ✓ Location "${locationData.name}" already exists`);
      } else {
        const [newLocation] = await db
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
          .returning({ id: locations.id });
        if (newLocation) {
          locationId = newLocation.id;
          locationMap.set(locationData.name, locationId);
          locationsCreated++;
          console.log(`   ✓ Created location "${locationData.name}"`);
        } else {
          throw new Error(`Failed to create location ${locationData.name}`);
        }
      }
    }

    // Step 5: Create suppliers
    console.log("\n🏪 Creating suppliers...");
    let suppliersCreated = 0;
    const supplierIds: string[] = [];

    for (const supplierData of supplierDefinitions) {
      const locationId = locationMap.get(supplierData.locationName) ?? null;
      if (!locationId) {
        console.warn(
          `   ⚠️  Location "${supplierData.locationName}" not found for supplier "${supplierData.name}"`,
        );
      }

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

      let supplierId: string;
      if (existing) {
        supplierId = existing.id;
        // Update existing supplier to ensure it has a location
        if (locationId && !existing.locationId) {
          await db
            .update(suppliers)
            .set({ locationId: locationId })
            .where(eq(suppliers.id, supplierId));
          console.log(
            `   ✓ Updated supplier "${supplierData.name}" with location`,
          );
        }
        supplierIds.push(supplierId);
        console.log(
          `   ✓ Supplier "${supplierData.name}" already exists (ID: ${supplierId})`,
        );
      } else {
        const [newSupplier] = await db
          .insert(suppliers)
          .values({
            organizationId: organizationId,
            name: supplierData.name,
            contactEmail: supplierData.contactEmail,
            contactPhone: supplierData.contactPhone,
            orderingNotes: supplierData.orderingNotes,
            locationId: locationId,
          })
          .returning({ id: suppliers.id });
        if (newSupplier) {
          supplierId = newSupplier.id;
          supplierIds.push(supplierId);
          suppliersCreated++;
          console.log(
            `   ✓ Created supplier "${supplierData.name}" (ID: ${supplierId})`,
          );
        } else {
          console.warn(
            `   ⚠️  Failed to create supplier "${supplierData.name}"`,
          );
        }
      }
    }

    // Step 6: Ensure all parts have at least one supplier
    let supplierPartsCreated = 0;

    if (supplierIds.length === 0) {
      console.warn("   ⚠️  No suppliers available, skipping supplier parts");
    } else {
      console.log("\n🔗 Linking parts to suppliers...");

      // Get all global parts (both newly created and existing)
      const allParts = await db
        .select({
          id: partDefinitions.id,
          displayName: partDefinitions.displayName,
        })
        .from(partDefinitions)
        .where(isNull(partDefinitions.organizationId));

      console.log(`   Found ${allParts.length} global parts to link`);
      console.log(`   Available suppliers: ${supplierIds.length}`);

      for (const part of allParts) {
        // Check if this part already has any supplier parts for this organization
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

        if (existingSupplierParts.length === 0) {
          // Part has no supplier, assign one randomly
          const randomSupplierId =
            supplierIds[Math.floor(Math.random() * supplierIds.length)] ??
            supplierIds[0];

          if (randomSupplierId) {
            // Generate a simple SKU based on part name
            const sku = part.displayName
              .replace(/[^a-zA-Z0-9]/g, "")
              .substring(0, 20)
              .toUpperCase();

            try {
              // Generate a realistic price based on part type and size
              // Prices in cents (CAD)
              let basePrice = 500; // $5.00 default
              if (part.displayName.includes("Pipe")) {
                basePrice = 2000 + Math.floor(Math.random() * 5000); // $20-$70
              } else if (part.displayName.includes("Valve")) {
                basePrice = 1500 + Math.floor(Math.random() * 3500); // $15-$50
              } else if (
                part.displayName.includes("Elbow") ||
                part.displayName.includes("Tee")
              ) {
                basePrice = 300 + Math.floor(Math.random() * 1200); // $3-$15
              } else if (part.displayName.includes("Coupling")) {
                basePrice = 200 + Math.floor(Math.random() * 800); // $2-$10
              } else if (
                part.displayName.includes("Wrench") ||
                part.displayName.includes("Cutter")
              ) {
                basePrice = 3000 + Math.floor(Math.random() * 7000); // $30-$100
              }

              // Adjust for size (larger = more expensive)
              if (part.displayName.includes("3/4")) {
                basePrice = Math.floor(basePrice * 1.3);
              } else if (part.displayName.includes("1/2")) {
                basePrice = Math.floor(basePrice * 1.1);
              }

              // Convert to string with 2 decimal places
              const priceString = (basePrice / 100).toFixed(2);

              await db.insert(supplierParts).values({
                organizationId: organizationId,
                supplierId: randomSupplierId,
                partDefinitionId: part.id,
                supplierSku: `${sku}-${Math.floor(Math.random() * 1000)}`,
                supplierName: part.displayName,
                packSize: 1,
                packUomId: unitMap.get("ea") ?? null,
                lastKnownUnitCost: priceString,
                currency: "CAD",
                isPreferred: false,
                notes: null,
              });

              supplierPartsCreated++;
              if (supplierPartsCreated % 5 === 0) {
                console.log(
                  `   ✓ Linked ${supplierPartsCreated} parts to suppliers...`,
                );
              }
            } catch (error) {
              console.warn(
                `   ⚠️  Failed to link part "${part.displayName}" to supplier:`,
                error,
              );
            }
          } else {
            console.warn(
              `   ⚠️  No supplier ID available for part "${part.displayName}"`,
            );
          }
        }
      }

      console.log(`   ✓ Linked ${supplierPartsCreated} parts to suppliers`);
    }

    // Step 7: Update existing supplier parts to have prices if they don't
    console.log("\n💰 Ensuring all supplier parts have prices...");
    const allSupplierParts = await db
      .select({
        id: supplierParts.id,
        partDefinitionId: supplierParts.partDefinitionId,
        lastKnownUnitCost: supplierParts.lastKnownUnitCost,
      })
      .from(supplierParts)
      .where(
        and(
          eq(supplierParts.organizationId, organizationId),
          isNull(supplierParts.lastKnownUnitCost),
        ),
      );

    let pricesUpdated = 0;
    for (const sp of allSupplierParts) {
      // Get part definition to generate price
      const [partDef] = await db
        .select({ displayName: partDefinitions.displayName })
        .from(partDefinitions)
        .where(eq(partDefinitions.id, sp.partDefinitionId))
        .limit(1);

      if (partDef) {
        let basePrice = 500; // $5.00 default
        if (partDef.displayName.includes("Pipe")) {
          basePrice = 2000 + Math.floor(Math.random() * 5000);
        } else if (partDef.displayName.includes("Valve")) {
          basePrice = 1500 + Math.floor(Math.random() * 3500);
        } else if (
          partDef.displayName.includes("Elbow") ||
          partDef.displayName.includes("Tee")
        ) {
          basePrice = 300 + Math.floor(Math.random() * 1200);
        } else if (partDef.displayName.includes("Coupling")) {
          basePrice = 200 + Math.floor(Math.random() * 800);
        } else if (
          partDef.displayName.includes("Wrench") ||
          partDef.displayName.includes("Cutter")
        ) {
          basePrice = 3000 + Math.floor(Math.random() * 7000);
        }

        if (partDef.displayName.includes("3/4")) {
          basePrice = Math.floor(basePrice * 1.3);
        } else if (partDef.displayName.includes("1/2")) {
          basePrice = Math.floor(basePrice * 1.1);
        }

        const priceString = (basePrice / 100).toFixed(2);

        await db
          .update(supplierParts)
          .set({ lastKnownUnitCost: priceString })
          .where(eq(supplierParts.id, sp.id));

        pricesUpdated++;
      }
    }

    if (pricesUpdated > 0) {
      console.log(`   ✓ Updated ${pricesUpdated} supplier parts with prices`);
    } else {
      console.log(`   ✓ All supplier parts already have prices`);
    }

    console.log(`\n🎉 Plumbing seed completed successfully!`);
    console.log(`📊 Summary:`);
    console.log(`   - Units: ${unitMap.size}`);
    console.log(`   - Categories: ${categoryMap.size}`);
    console.log(`   - Parts created: ${partsCreated}`);
    console.log(`   - Synonyms created: ${synonymsCreated}`);
    console.log(`   - Locations created: ${locationsCreated}`);
    console.log(`   - Suppliers created: ${suppliersCreated}`);
    console.log(`   - Supplier parts linked: ${supplierPartsCreated}`);
    console.log(`   - Prices updated: ${pricesUpdated}`);
  } catch (error) {
    console.error("❌ Error seeding plumbing data:", error);
    throw error;
  }
}

// Check for flags
// --no-clear: Skip clearing the database
// --clear: Explicitly clear the database (default behavior)
// --no-migrate: Skip running migrations
const shouldClear = !process.argv.includes("--no-clear");
const shouldRunMigrations = !process.argv.includes("--no-migrate");

// Run seed when this script is executed directly
// Default behavior: clear -> push -> seed
seedPlumbing(shouldClear, shouldRunMigrations)
  .then(async () => {
    console.log("✅ Seed script completed");
    await db.$client.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("❌ Seed script failed:", error);
    // If tables don't exist, provide helpful message
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (
        errorMessage.includes("does not exist") ||
        errorMessage.includes("relation") ||
        errorMessage.includes("table")
      ) {
        console.error(
          "\n⚠️  Database tables don't exist. Please run migrations first:",
        );
        console.error("   pnpm db:push");
        console.error(
          "   Then run seed again: pnpm tsx scripts/seed-plumbing.ts",
        );
      }
    }
    await db.$client.end();
    process.exit(1);
  });
