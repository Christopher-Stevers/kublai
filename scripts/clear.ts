import "dotenv/config";
import postgres from "postgres";
import { env } from "~/env";

/**
 * Truncates all tables in the database.
 * Uses CASCADE to automatically handle foreign key constraints.
 */
async function clearDatabase() {
  const sql = postgres(env.DATABASE_URL);

  try {
    console.log("Truncating all tables...");

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
  } catch (error) {
    console.error("❌ Error truncating tables:", error);
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
