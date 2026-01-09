import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { env } from "../src/env.js";

const conn = postgres(env.DATABASE_URL);
const db = drizzle(conn);

async function applyCreativeMigration() {
  try {
    console.log("Checking current creative table structure...");

    // Check if columns already exist
    const result = await conn`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'kublai_creative'
      ORDER BY column_name;
    `;

    const existingColumns = result.map(
      (r: { column_name: string }) => r.column_name,
    );
    console.log("Existing columns:", existingColumns);

    const requiredColumns = [
      "userId",
      "fileType",
      "filePath",
      "fileSize",
      "mimeType",
      "approvedBy",
      "approvedAt",
    ];
    const missingColumns = requiredColumns.filter(
      (col) => !existingColumns.includes(col),
    );

    if (missingColumns.length === 0) {
      console.log("✓ All required columns already exist!");
      return;
    }

    console.log("Missing columns:", missingColumns);
    console.log("Applying migration...");

    // Step 1: Add nullable columns first
    for (const col of missingColumns) {
      let sqlType = "";
      switch (col) {
        case "userId":
          sqlType = "varchar(255)";
          break;
        case "fileType":
          sqlType = "varchar(50)";
          break;
        case "filePath":
          sqlType = "text";
          break;
        case "fileSize":
          sqlType = "bigint";
          break;
        case "mimeType":
          sqlType = "varchar(100)";
          break;
        case "approvedBy":
          sqlType = "varchar(255)";
          break;
        case "approvedAt":
          sqlType = "timestamp with time zone";
          break;
      }

      if (sqlType) {
        await conn.unsafe(
          `ALTER TABLE "kublai_creative" ADD COLUMN IF NOT EXISTS "${col}" ${sqlType};`,
        );
        console.log(`  ✓ Added column: ${col}`);
      }
    }

    // Step 2: Delete any existing rows without userId (they're invalid for new schema)
    const deleteResult =
      await conn`DELETE FROM "kublai_creative" WHERE "userId" IS NULL RETURNING id;`;
    if (deleteResult.length > 0) {
      console.log(`  ⚠ Deleted ${deleteResult.length} rows without userId`);
    }

    // Step 3: Make required columns NOT NULL
    const notNullColumns = [
      "userId",
      "fileType",
      "filePath",
      "fileSize",
      "mimeType",
    ];
    for (const col of notNullColumns) {
      if (missingColumns.includes(col)) {
        await conn.unsafe(
          `ALTER TABLE "kublai_creative" ALTER COLUMN "${col}" SET NOT NULL;`,
        );
        console.log(`  ✓ Set ${col} to NOT NULL`);
      }
    }

    // Step 4: Add foreign key constraints
    if (missingColumns.includes("userId")) {
      await conn.unsafe(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'kublai_creative_userId_kublai_user_id_fk'
          ) THEN
            ALTER TABLE "kublai_creative" 
            ADD CONSTRAINT "kublai_creative_userId_kublai_user_id_fk" 
            FOREIGN KEY ("userId") REFERENCES "public"."kublai_user"("id") 
            ON DELETE no action ON UPDATE no action;
          END IF;
        END $$;
      `);
      console.log("  ✓ Added userId foreign key");
    }

    if (missingColumns.includes("approvedBy")) {
      await conn.unsafe(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'kublai_creative_approvedBy_kublai_user_id_fk'
          ) THEN
            ALTER TABLE "kublai_creative" 
            ADD CONSTRAINT "kublai_creative_approvedBy_kublai_user_id_fk" 
            FOREIGN KEY ("approvedBy") REFERENCES "public"."kublai_user"("id") 
            ON DELETE no action ON UPDATE no action;
          END IF;
        END $$;
      `);
      console.log("  ✓ Added approvedBy foreign key");
    }

    console.log("\n✓ Migration applied successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await conn.end();
  }
}

applyCreativeMigration();
