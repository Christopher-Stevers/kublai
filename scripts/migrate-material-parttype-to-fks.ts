/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import {
  partDefinitions,
  materials,
  partTypes,
  organizations,
} from "~/server/db/schema";
import { eq, and, isNull, sql, or } from "drizzle-orm";

async function migrateMaterialAndPartTypeToFKs() {
  console.log("🔄 Starting migration: material and partType strings to foreign keys");

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  const client = postgres(env.DATABASE_URL, { max: 1 });
  const db = drizzle(client);

  try {
    // Step 1: Get all unique material strings from partDefinitions
    console.log("\n📊 Analyzing existing data...");
    const materialStringsRaw = await db.execute(
      sql.raw(`
        SELECT DISTINCT "material", "organizationId"
        FROM "kublai_part_definition"
        WHERE "material" IS NOT NULL
      `),
    );
    const materialStrings = materialStringsRaw.map((row: any) => ({
      material: row.material,
      organizationId: row.organizationId,
    }));

    console.log(`   Found ${materialStrings.length} unique material strings`);

    // Step 2: For each material string, find or create material record
    const materialMap = new Map<string, string>(); // material string -> material ID

    for (const { material, organizationId } of materialStrings) {
      if (!material) continue;

      // Try to find existing material by name (case-insensitive) for the same org
      const [existing] = await db
        .select()
        .from(materials)
        .where(
          and(
            sql`LOWER(${materials.name}) = LOWER(${material})`,
            organizationId
              ? eq(materials.organizationId, organizationId)
              : isNull(materials.organizationId),
          ),
        )
        .limit(1);

      if (existing) {
        materialMap.set(material, existing.id);
        console.log(`   ✓ Found existing material: ${material} -> ${existing.id}`);
      } else {
        // Create new material record
        const [newMaterial] = await db
          .insert(materials)
          .values({
            organizationId: organizationId ?? null,
            name: material.trim(),
          })
          .returning();

        if (newMaterial) {
          materialMap.set(material, newMaterial.id);
          console.log(`   ✓ Created new material: ${material} -> ${newMaterial.id}`);
        }
      }
    }

    // Step 3: Get all unique partType strings from partDefinitions
    const partTypeStringsRaw = await db.execute(
      sql.raw(`
        SELECT DISTINCT "partType", "organizationId"
        FROM "kublai_part_definition"
        WHERE "partType" IS NOT NULL
      `),
    );
    const partTypeStrings = partTypeStringsRaw.map((row: any) => ({
      partType: row.partType,
      organizationId: row.organizationId,
    }));

    console.log(`   Found ${partTypeStrings.length} unique partType strings`);

    // Step 4: For each partType string, find or create partType record
    const partTypeMap = new Map<string, string>(); // partType string -> partType ID

    for (const { partType, organizationId } of partTypeStrings) {
      if (!partType) continue;

      // Try to find existing partType by name (case-insensitive) for the same org
      const [existing] = await db
        .select()
        .from(partTypes)
        .where(
          and(
            sql`LOWER(${partTypes.name}) = LOWER(${partType})`,
            organizationId
              ? eq(partTypes.organizationId, organizationId)
              : isNull(partTypes.organizationId),
          ),
        )
        .limit(1);

      if (existing) {
        partTypeMap.set(partType, existing.id);
        console.log(`   ✓ Found existing partType: ${partType} -> ${existing.id}`);
      } else {
        // Create new partType record
        const [newPartType] = await db
          .insert(partTypes)
          .values({
            organizationId: organizationId ?? null,
            name: partType.trim(),
          })
          .returning();

        if (newPartType) {
          partTypeMap.set(partType, newPartType.id);
          console.log(`   ✓ Created new partType: ${partType} -> ${newPartType.id}`);
        }
      }
    }

    // Step 5: Update all partDefinitions with materialId
    console.log("\n🔄 Updating partDefinitions with materialId...");
    let materialUpdates = 0;
    for (const [materialString, materialId] of materialMap.entries()) {
      const result = await client`
        UPDATE "kublai_part_definition"
        SET "materialId" = ${materialId}::uuid
        WHERE "material" = ${materialString}
      `;
      materialUpdates += result.count ?? 0;
    }
    console.log(`   ✓ Updated ${materialUpdates} partDefinitions with materialId`);

    // Step 6: Update all partDefinitions with partTypeId
    console.log("\n🔄 Updating partDefinitions with partTypeId...");
    let partTypeUpdates = 0;
    for (const [partTypeString, partTypeId] of partTypeMap.entries()) {
      const result = await client`
        UPDATE "kublai_part_definition"
        SET "partTypeId" = ${partTypeId}::uuid
        WHERE "partType" = ${partTypeString}
      `;
      partTypeUpdates += result.count ?? 0;
    }
    console.log(`   ✓ Updated ${partTypeUpdates} partDefinitions with partTypeId`);

    // Step 7: Drop old columns (after verifying data is migrated)
    console.log("\n🗑️  Dropping old columns...");
    await db.execute(sql.raw(`ALTER TABLE "kublai_part_definition" DROP COLUMN IF EXISTS "material";`));
    await db.execute(sql.raw(`ALTER TABLE "kublai_part_definition" DROP COLUMN IF EXISTS "partType";`));
    console.log("   ✓ Dropped old material and partType columns");

    console.log("\n✅ Migration completed successfully!");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migration
migrateMaterialAndPartTypeToFKs()
  .then(() => {
    console.log("Migration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });

