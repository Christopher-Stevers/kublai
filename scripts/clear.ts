import "dotenv/config";
import postgres from "postgres";
import { env } from "~/env";

/**
 * Truncates all tables in the database and ensures schema is up to date.
 * Uses CASCADE to automatically handle foreign key constraints.
 * Also handles migration from old sizeNominal/sizeUnitId to sizeId.
 */
async function clearDatabase() {
  const sql = postgres(env.DATABASE_URL);

  try {
    // Step 1: Check and handle schema migration for part_definition table
    console.log("Checking schema migration status...");

    // Check if old columns exist
    const oldColumnsCheck = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'kublai_part_definition'
      AND column_name IN ('size_nominal', 'size_unit_id')
    `;

    // Check if new column exists
    const newColumnCheck = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_schema = 'public' 
      AND table_name = 'kublai_part_definition'
      AND column_name = 'size_id'
    `;

    if (oldColumnsCheck.length > 0 && newColumnCheck.length === 0) {
      console.log("⚠️  Old size columns found but new size_id column missing.");
      console.log("   Running migration to add size_id column...");

      // Add size_id column if it doesn't exist
      await sql`
        ALTER TABLE kublai_part_definition 
        ADD COLUMN IF NOT EXISTS size_id UUID REFERENCES kublai_size(id) ON DELETE SET NULL
      `;

      // For empty tables, we can just drop old columns and make size_id non-nullable
      // But we'll check if table is empty first
      const rowCount = await sql`
        SELECT COUNT(*) as count FROM kublai_part_definition
      `;

      if (rowCount[0]?.count === "0" || rowCount[0]?.count === 0) {
        console.log(
          "   Table is empty, dropping old columns and making size_id non-nullable...",
        );
        await sql`
          ALTER TABLE kublai_part_definition 
          DROP COLUMN IF EXISTS size_nominal,
          DROP COLUMN IF EXISTS size_unit_id
        `;
        await sql`
          ALTER TABLE kublai_part_definition 
          ALTER COLUMN size_id SET NOT NULL
        `;
        console.log("   ✅ Schema migration completed!");
      } else {
        console.log(
          "   ⚠️  Table has data. Please run the full migration script first.",
        );
        console.log(
          "   Run: tsx scripts/migrate-part-definition-size-to-sizeid.ts",
        );
      }
    } else if (oldColumnsCheck.length > 0 && newColumnCheck.length > 0) {
      // Both exist - drop old columns after truncating
      console.log(
        "   Both old and new columns exist. Will drop old columns after truncating.",
      );
    } else if (oldColumnsCheck.length === 0 && newColumnCheck.length > 0) {
      console.log("   ✅ Schema is already migrated (using size_id).");
    }

    console.log("\nTruncating all tables...");

    // Get all tables with the kublai_ prefix
    const tables = await sql`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename LIKE 'kublai_%'
      ORDER BY tablename;
    `;

    if (tables.length === 0) {
      console.log("No tables found with prefix 'kublai_'");
      return;
    }

    // Tables to exclude from truncation (users, orgs, and NextAuth tables)
    const protectedTables = [
      "kublai_user",
      "kublai_organization",
      "kublai_account",
      "kublai_session",
      "kublai_verification_token",
    ];

    // Filter out protected tables
    const tablesToTruncate = tables.filter(
      (table) => !protectedTables.includes(table.tablename),
    );

    const skippedTables = tables.filter((table) =>
      protectedTables.includes(table.tablename),
    );

    console.log(`Found ${tables.length} total tables:`);
    tablesToTruncate.forEach((table) => {
      console.log(`  - ${table.tablename} (will truncate)`);
    });

    if (skippedTables.length > 0) {
      console.log(`\nSkipping ${skippedTables.length} protected tables:`);
      skippedTables.forEach((table) => {
        console.log(`  - ${table.tablename} (PROTECTED - preserved)`);
      });
    }

    if (tablesToTruncate.length === 0) {
      console.log("\nNo tables to truncate (all tables are protected)");
      return;
    }

    // Reset user foreign key references to prevent constraint violations
    console.log("\n🔄 Resetting user foreign key references...");
    try {
      await sql`
        UPDATE kublai_user 
        SET "currentJobId" = NULL, "pricingProfileId" = NULL;
      `;
      console.log("   ✓ User references reset");
    } catch (err) {
      console.log(
        "   ℹ️  Could not reset user references (table may not exist or no users)",
      );
    }

    // Truncate tables individually in dependency order (no CASCADE to protect users/orgs)
    console.log("\n🗑️  Truncating tables in dependency order...");

    // Define truncation order: child tables first, then parents
    // This avoids foreign key constraint violations without using CASCADE
    const truncationOrder = [
      // Quote/Order items (most dependent)
      "kublai_quote_item",
      "kublai_order_item",
      // Quotes and orders
      "kublai_quote",
      "kublai_order",
      // Material lists and jobs
      "kublai_material_list",
      "kublai_job_supplier",
      "kublai_job",
      // Supplier parts and parts catalog
      "kublai_supplier_part",
      "kublai_part_attribute",
      "kublai_part_synonym",
      "kublai_part_definition",
      // Suppliers and locations
      "kublai_supplier",
      "kublai_location",
      // Pricing and categorization
      "kublai_pricing_profile",
      "kublai_category",
      // Facets and units
      "kublai_unit",
      "kublai_material",
      "kublai_size",
      "kublai_part_type",
    ];

    // Filter to only include tables that exist in our database
    const existingTableNames = tablesToTruncate.map((t) => t.tablename);
    const tablesToDelete = truncationOrder.filter((name) =>
      existingTableNames.includes(name),
    );

    // Truncate each table individually
    for (const tableName of tablesToDelete) {
      try {
        await sql.unsafe(`TRUNCATE TABLE ${tableName} RESTART IDENTITY;`);
        console.log(`   ✓ Truncated ${tableName}`);
      } catch (err) {
        console.log(`   ⚠️  Could not truncate ${tableName}: ${err}`);
      }
    }

    console.log(`\n✅ ${tablesToDelete.length} tables truncated successfully!`);
    console.log(
      `   ${skippedTables.length} protected tables preserved (users, orgs, NextAuth)`,
    );

    // Step 2: After truncating, ensure schema is correct
    if (oldColumnsCheck.length > 0) {
      console.log("\nCleaning up old schema columns...");
      await sql`
        ALTER TABLE kublai_part_definition 
        DROP COLUMN IF EXISTS size_nominal,
        DROP COLUMN IF EXISTS size_unit_id
      `;

      // Ensure size_id exists and is non-nullable
      await sql`
        ALTER TABLE kublai_part_definition 
        ADD COLUMN IF NOT EXISTS size_id UUID REFERENCES kublai_size(id) ON DELETE SET NULL
      `;

      // Make it non-nullable (safe after truncate)
      await sql`
        ALTER TABLE kublai_part_definition 
        ALTER COLUMN size_id SET NOT NULL
      `;

      // Update index
      await sql`
        DROP INDEX IF EXISTS part_def_facets_idx
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS part_def_facets_idx 
        ON kublai_part_definition(part_type_id, material_id, size_id)
      `;
      await sql`
        CREATE INDEX IF NOT EXISTS part_def_size_idx 
        ON kublai_part_definition(size_id)
      `;

      console.log("✅ Schema cleanup completed!");
    }
  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    await sql.end();
  }
}

clearDatabase()
  .then(() => {
    console.log("Done!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Failed:", error);
    process.exit(1);
  });
