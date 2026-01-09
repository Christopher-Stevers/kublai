import "dotenv/config";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

/**
 * Seed script to populate the database with plumbing categories, parts, and suppliers
 *
 * This script is a wrapper that calls seedPlumbing from clear-db.ts
 * Run with: pnpm tsx scripts/seed-plumbing.ts
 */

// Simple lock file to prevent concurrent execution
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

// Check for flags
// --no-clear: Skip clearing the database
// --clear: Explicitly clear the database (default behavior)
// --no-migrate: Skip running migrations
const shouldClear = !process.argv.includes("--no-clear");
const shouldRunMigrations = !process.argv.includes("--no-migrate");

// Import and run seed - we import AFTER ensuring database exists to avoid connection errors
// First, ensure database exists before importing anything that would connect to it
async function main() {
  // Acquire lock to prevent concurrent execution
  acquireLock();

  try {
    // Import ensureDatabaseExists first (it doesn't require db connection)
    const { ensureDatabaseExists } = await import("./clear-db");

    // Ensure database exists BEFORE importing anything that would connect to it
    await ensureDatabaseExists();

    // Now it's safe to import seedPlumbing (which imports db)
    const { seedPlumbing } = await import("./clear-db");

    // Run seed
    await seedPlumbing(shouldClear, shouldRunMigrations);
  } finally {
    // Always release lock
    releaseLock();
  }
}

// Run seed when this script is executed directly
// Default behavior: clear -> push -> seed
main()
  .then(() => {
    console.log("✅ Seed script completed");
    process.exit(0);
  })
  .catch((error) => {
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
    process.exit(1);
  })
  .finally(() => {
    // Ensure lock is released even if process is killed
    releaseLock();
  });
