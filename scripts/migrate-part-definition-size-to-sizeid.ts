import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and } from "drizzle-orm";
import { sizes, units } from "~/server/db/schema";
import { env } from "~/env";

async function migratePartDefinitionSizeToSizeId() {
  const connection = postgres(env.DATABASE_URL);
  const db = drizzle(connection, { schema: { sizes, units } });

  try {
    console.log("Starting migration: part_definition sizeNominal/sizeUnitId -> sizeId");

    // Step 1: Add sizeId column (nullable initially)
    console.log("Step 1: Adding sizeId column...");
    await connection`
      ALTER TABLE kublai_part_definition 
      ADD COLUMN IF NOT EXISTS size_id UUID REFERENCES kublai_size(id) ON DELETE SET NULL
    `;

    // Step 2: Get all part definitions with size information using raw SQL
    console.log("Step 2: Processing part definitions with sizes...");
    const partsWithSize = (await connection`
      SELECT id, organization_id, size_nominal, size_unit_id
      FROM kublai_part_definition
      WHERE size_nominal IS NOT NULL AND size_unit_id IS NOT NULL
    `) as Array<{
      id: string;
      organization_id: string;
      size_nominal: string | null;
      size_unit_id: string | null;
    }>;

    console.log(`Found ${partsWithSize.length} parts with size information`);

    // Step 3: For each part, find or create size record and set sizeId
    let sizesCreated = 0;
    let sizesFound = 0;
    let partsUpdated = 0;

    for (const part of partsWithSize) {
      if (!part.organization_id || !part.size_nominal || !part.size_unit_id) {
        console.warn(`Skipping part ${part.id} - missing required fields`);
        continue;
      }

      // Find existing size
      const [existingSize] = await db
        .select()
        .from(sizes)
        .where(
          and(
            eq(sizes.organizationId, part.organization_id),
            eq(sizes.nominal, part.size_nominal),
            eq(sizes.unitId, part.size_unit_id),
          ),
        )
        .limit(1);

      let sizeId: string;

      if (existingSize) {
        sizeId = existingSize.id;
        sizesFound++;
      } else {
        // Create new size record
        const [newSize] = await db
          .insert(sizes)
          .values({
            organizationId: part.organization_id,
            nominal: part.size_nominal,
            unitId: part.size_unit_id,
          })
          .returning();
        if (!newSize) {
          console.error(`Failed to create size for part ${part.id}`);
          continue;
        }
        sizeId = newSize.id;
        sizesCreated++;
      }

      // Update part definition with sizeId using raw SQL
      await connection`
        UPDATE kublai_part_definition
        SET size_id = ${sizeId}
        WHERE id = ${part.id}
      `;

      partsUpdated++;
    }

    console.log(`Created ${sizesCreated} new sizes, found ${sizesFound} existing sizes`);
    console.log(`Updated ${partsUpdated} part definitions with sizeId`);

    // Step 4: Handle parts without size (create default "no size" size for each org)
    console.log("Step 4: Handling parts without size...");
    const partsWithoutSize = (await connection`
      SELECT id, organization_id
      FROM kublai_part_definition
      WHERE size_nominal IS NULL OR size_unit_id IS NULL
    `) as Array<{
      id: string;
      organization_id: string;
    }>;

    console.log(`Found ${partsWithoutSize.length} parts without size information`);

    // Get unique organization IDs
    const orgIds = new Set(
      partsWithoutSize
        .map((p) => p.organization_id)
        .filter((id): id is string => id !== null),
    );

    // Get all units to find a default
    const allUnits = await db.select().from(units).limit(1);
    const defaultUnitId = allUnits[0]?.id;

    if (!defaultUnitId) {
      throw new Error("No units found in database - cannot create default sizes");
    }

    const defaultSizeMap = new Map<string, string>();

    for (const orgId of orgIds) {
      // Check if default size already exists
      const [existingDefaultSize] = await db
        .select()
        .from(sizes)
        .where(
          and(
            eq(sizes.organizationId, orgId),
            eq(sizes.nominal, "0"),
            eq(sizes.unitId, defaultUnitId),
          ),
        )
        .limit(1);

      let defaultSizeId: string;

      if (existingDefaultSize) {
        defaultSizeId = existingDefaultSize.id;
      } else {
        // Create default "no size" size
        const [newDefaultSize] = await db
          .insert(sizes)
          .values({
            organizationId: orgId,
            nominal: "0",
            unitId: defaultUnitId,
          })
          .returning();

        if (!newDefaultSize) {
          console.error(`Failed to create default size for org ${orgId}`);
          continue;
        }
        defaultSizeId = newDefaultSize.id;
        console.log(`Created default 'no size' size for organization ${orgId}`);
      }

      defaultSizeMap.set(orgId, defaultSizeId);
    }

    // Update parts without size to use default size
    let partsWithoutSizeUpdated = 0;
    for (const part of partsWithoutSize) {
      if (!part.organization_id) {
        console.warn(`Skipping part ${part.id} - no organizationId`);
        continue;
      }

      const defaultSizeId = defaultSizeMap.get(part.organization_id);
      if (!defaultSizeId) {
        console.warn(`No default size found for org ${part.organization_id}`);
        continue;
      }

      await connection`
        UPDATE kublai_part_definition
        SET size_id = ${defaultSizeId}
        WHERE id = ${part.id}
      `;

      partsWithoutSizeUpdated++;
    }

    console.log(`Updated ${partsWithoutSizeUpdated} parts without size to use default size`);

    // Step 5: Make sizeId non-nullable
    console.log("Step 5: Making sizeId non-nullable...");
    await connection`
      ALTER TABLE kublai_part_definition 
      ALTER COLUMN size_id SET NOT NULL
    `;

    // Step 6: Drop old columns
    console.log("Step 6: Dropping old columns...");
    await connection`
      ALTER TABLE kublai_part_definition 
      DROP COLUMN IF EXISTS size_nominal,
      DROP COLUMN IF EXISTS size_unit_id
    `;

    // Step 7: Update index (drop old, add new)
    console.log("Step 7: Updating indexes...");
    await connection`
      DROP INDEX IF EXISTS part_def_facets_idx
    `;
    await connection`
      CREATE INDEX IF NOT EXISTS part_def_facets_idx 
      ON kublai_part_definition(material_id, size_id)
    `;
    await connection`
      CREATE INDEX IF NOT EXISTS part_def_size_idx 
      ON kublai_part_definition(size_id)
    `;

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Error during migration:", error);
    throw error;
  } finally {
    await connection.end();
  }
}

migratePartDefinitionSizeToSizeId()
  .then(() => {
    console.log("Migration script finished.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Migration script failed:", error);
    process.exit(1);
  });
