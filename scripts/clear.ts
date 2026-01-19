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
        console.log("   Table is empty, dropping old columns and making size_id non-nullable...");
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
        console.log("   ⚠️  Table has data. Please run the full migration script first.");
        console.log("   Run: tsx scripts/migrate-part-definition-size-to-sizeid.ts");
      }
    } else if (oldColumnsCheck.length > 0 && newColumnCheck.length > 0) {
      // Both exist - drop old columns after truncating
      console.log("   Both old and new columns exist. Will drop old columns after truncating.");
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

    console.log(`Found ${tables.length} tables to truncate:`);
    tables.forEach((table) => {
      console.log(`  - ${table.tablename}`);
    });

    // Truncate all tables with CASCADE to handle foreign key constraints
    const tableNames = tables.map((t) => t.tablename).join(", ");
    await sql.unsafe(`TRUNCATE TABLE ${tableNames} RESTART IDENTITY CASCADE;`);

    console.log("✅ All tables truncated successfully!");

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
