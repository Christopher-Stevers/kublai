import "dotenv/config";
import { db } from "../src/server/db";
import { sql } from "drizzle-orm";

async function clearDatabase() {
  console.log("Clearing database...");

  try {
    // Drop all tables with the kublai_ prefix
    await db.execute(
      sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;`,
    );

    console.log("Database cleared successfully!");
  } catch (error) {
    console.error("Error clearing database:", error);
    throw error;
  } finally {
    await db.$client.end();
    process.exit(0);
  }
}

clearDatabase();

