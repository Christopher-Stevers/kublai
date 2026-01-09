import "dotenv/config";
// Don't import db at top level - it will try to connect immediately
// We'll import it lazily when needed
import { sql } from "drizzle-orm";
import { users } from "../src/server/db/schema";
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
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import type { db as dbType } from "../src/server/db";

const execAsync = promisify(exec);

// Type for drizzle database instance
type DrizzleDb = typeof dbType;

// Lazy import of db to avoid immediate connection
async function getDb(): Promise<DrizzleDb> {
  const { db } = await import("../src/server/db");
  return db;
}

const CLERK_API_URL = "https://api.clerk.com/v1";

interface ClerkUser {
  id: string;
  email_addresses: Array<{ email_address: string; id: string }>;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
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

// Part definitions with realistic plumbing data
const partDefinitionsData = [
  // Elbows
  {
    categoryName: "Elbows",
    displayName: "90° Copper Elbow",
    description: "90 degree copper elbow fitting for water lines",
    material: "Copper",
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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
    lastKnownUnitCost: 10.0,
    currency: "CAD",
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

async function fetchAllClerkUsers(): Promise<ClerkUser[]> {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY environment variable is not set");
  }

  const allUsers: ClerkUser[] = [];
  let offset = 0;
  const limit = 500; // Clerk API limit

  console.log("Fetching users from Clerk...");

  while (true) {
    const url = `${CLERK_API_URL}/users?limit=${limit}&offset=${offset}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${clerkSecretKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch users from Clerk: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    const jsonData = (await response.json()) as
      | ClerkUser[]
      | { data: ClerkUser[]; total_count?: number };

    // Handle different response structures
    let users: ClerkUser[] = [];
    if (Array.isArray(jsonData)) {
      // Response is directly an array
      users = jsonData;
    } else if (
      jsonData &&
      typeof jsonData === "object" &&
      "data" in jsonData &&
      Array.isArray(jsonData.data)
    ) {
      // Response has a data property with array
      users = jsonData.data;
    } else {
      console.warn(
        "Unexpected Clerk API response structure:",
        JSON.stringify(jsonData).substring(0, 200),
      );
      break;
    }

    if (users.length === 0) {
      break;
    }

    allUsers.push(...users);

    // If we got fewer users than the limit, we've reached the end
    if (users.length < limit) {
      break;
    }

    offset += limit;
  }

  console.log(`Fetched ${allUsers.length} users from Clerk`);
  return allUsers;
}

export async function runMigrations(database?: DrizzleDb) {
  console.log("🔄 Running database migrations...");
  try {
    // Get database connection if not provided
    const dbToUse = database ?? (await getDb());

    // Check if migrations table exists in drizzle schema (from previous run)
    // If it does, we'll move it to kublai_drizzle after creating the schema
    const [existingDrizzleTable] = await dbToUse.execute(sql`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'drizzle' 
      AND table_name = '__drizzle_migrations'
    `);

    // Check if there are OTHER tables in the drizzle schema (indicating another app)
    const otherTablesResult = await dbToUse.execute(sql`
      SELECT COUNT(*)::int as count
      FROM information_schema.tables 
      WHERE table_schema = 'drizzle' 
      AND table_name != '__drizzle_migrations'
    `);

    const otherTablesCount =
      (otherTablesResult[0] as { count: number } | undefined)?.count ?? 0;
    if (existingDrizzleTable && otherTablesCount > 0) {
      // There are other tables in drizzle schema - this is likely another app
      const dbUrl = new URL(env.DATABASE_URL);
      const dbName = dbUrl.pathname.slice(1);
      console.error(
        "\n❌ ERROR: Another Drizzle application is using this database!",
      );
      console.error(
        `   The 'drizzle' schema contains other tables besides migrations.`,
      );
      console.error(
        `   This means another app is sharing the database "${dbName}".`,
      );
      console.error(
        "\n💡 SOLUTION: Use a separate database for this application.",
      );
      console.error(
        `   Update your DATABASE_URL in .env to use a dedicated database:`,
      );
      console.error(`   Example: postgresql://user:password@host:5432/kublai`);
      console.error(
        `   The script will automatically create the database if it doesn't exist.\n`,
      );
      throw new Error(
        "Cannot run migrations: database is shared with another Drizzle application. " +
          "Please use a separate database (update DATABASE_URL in .env).",
      );
    }

    // If migrations table exists in drizzle schema but no other tables, it's from a previous run
    // We'll move it to kublai_drizzle after creating the schema
    if (existingDrizzleTable) {
      console.log(
        "   ℹ️  Found existing migrations table in 'drizzle' schema (from previous run)",
      );
      console.log("   ℹ️  Will move it to 'kublai_drizzle' schema");
    }

    // Create kublai_drizzle schema if it doesn't exist
    // Use DO block to handle potential race conditions
    await dbToUse.execute(sql`
      DO $$ 
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'kublai_drizzle') THEN
          CREATE SCHEMA kublai_drizzle;
        END IF;
      END $$;
    `);

    // Check if migrations table already exists in kublai_drizzle (migrations already applied)
    const [existingKublaiMigrations] = await dbToUse.execute(sql`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'kublai_drizzle' 
      AND table_name = '__drizzle_migrations'
      LIMIT 1
    `);

    if (existingKublaiMigrations) {
      console.log(
        "   ✓ Migrations table already exists in kublai_drizzle schema",
      );
      console.log(
        "   ✓ Migrations have already been applied, skipping migration run",
      );
    } else {
      // Use drizzle-orm migrate API
      // Note: migrate() will create/use the "drizzle" schema by default - this is hardcoded
      const migrationConn = postgres(env.DATABASE_URL, { max: 1 });
      const { drizzle: createDrizzle } =
        await import("drizzle-orm/postgres-js");
      const migrationDb = createDrizzle(migrationConn);

      console.log("   Running migrations...");
      try {
        await migrate(migrationDb, { migrationsFolder: "./drizzle" });
      } finally {
        await migrationConn.end();
      }
    }

    // Move the migrations table from drizzle schema to kublai_drizzle if it exists there
    // This handles the case where migrations were run before and the table is in drizzle schema
    await dbToUse.execute(
      sql`
        DO $$ 
        BEGIN
          -- Move __drizzle_migrations table from drizzle schema to kublai_drizzle if it exists
          -- and doesn't already exist in kublai_drizzle
          IF EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'drizzle' 
            AND table_name = '__drizzle_migrations'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'kublai_drizzle' 
            AND table_name = '__drizzle_migrations'
          ) THEN
            ALTER TABLE drizzle.__drizzle_migrations SET SCHEMA kublai_drizzle;
            RAISE NOTICE 'Moved __drizzle_migrations table to kublai_drizzle schema';
          END IF;
          
          -- Only drop drizzle schema if it's completely empty
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'drizzle'
          ) THEN
            DROP SCHEMA IF EXISTS drizzle CASCADE;
          ELSE
            RAISE NOTICE 'Keeping drizzle schema as it contains other tables (possibly from another app)';
          END IF;
        END $$;
      `,
    );

    // Check if migrations table already exists in kublai_drizzle
    const migrationTableResult = await dbToUse.execute(sql`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = '__drizzle_migrations'
    `);

    const migrationTableCheck = migrationTableResult[0];
    if (migrationTableCheck) {
      const schema = (migrationTableCheck as any).table_schema;
      if (schema === "kublai_drizzle") {
        console.log("   ✓ Migrations table is in kublai_drizzle schema");
      } else {
        console.log(
          `   ⚠️  Migrations table is in ${schema} schema (expected kublai_drizzle)`,
        );
      }
    }

    // Clean up ALL orphaned composite types for kublai_ tables before running db:push
    // This prevents "duplicate key" errors when recreating tables
    // We drop all kublai_ types, not just orphaned ones, to ensure clean slate
    console.log("   Cleaning up orphaned types...");
    try {
      await dbToUse.execute(sql`
        DO $$ 
        DECLARE
          r RECORD;
          type_count INTEGER := 0;
        BEGIN
          -- Drop ALL composite types for kublai_ tables (they'll be recreated by db:push)
          FOR r IN 
            SELECT t.typname, n.nspname, t.oid as type_oid
            FROM pg_type t
            JOIN pg_namespace n ON t.typnamespace = n.oid
            WHERE n.nspname = 'public'
            AND t.typtype = 'c'
            AND t.typname LIKE 'kublai_%'
            ORDER BY t.oid DESC
          LOOP
            BEGIN
              -- Check if type is still in use by any table
              IF NOT EXISTS (
                SELECT 1 FROM pg_class c
                WHERE c.relname = r.typname
                AND c.relnamespace = r.type_oid
              ) THEN
                EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.nspname) || '.' || quote_ident(r.typname) || ' CASCADE';
                type_count := type_count + 1;
              END IF;
            EXCEPTION WHEN OTHERS THEN
              -- Ignore errors (type might be in use or already dropped)
              NULL;
            END;
          END LOOP;
          
          IF type_count > 0 THEN
            RAISE NOTICE 'Cleaned up % orphaned types', type_count;
          END IF;
        END $$;
      `);
    } catch (cleanupError) {
      // Type cleanup is best-effort - continue even if it fails
      console.log(
        "   ⚠️  Type cleanup encountered an error (continuing anyway):",
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError),
      );
    }

    // Run db:push to sync schema changes
    console.log("   Pushing schema changes...");
    try {
      const { stdout, stderr } = await execAsync("pnpm db:push");
      if (stdout) console.log(stdout);
      if (stderr && !stderr.includes("duplicate key")) {
        console.error(stderr);
      }

      // Verify that at least one table was created (check for kublai_user as it should always exist)
      const [tableCheck] = await dbToUse.execute(sql`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'kublai_user'
        LIMIT 1
      `);

      if (!tableCheck) {
        console.log(
          "   ⚠️  Tables not found after db:push, cleaning up types and retrying...",
        );
        // More aggressive type cleanup - drop ALL kublai_ types
        await dbToUse.execute(sql`
          DO $$ 
          DECLARE
            r RECORD;
          BEGIN
            FOR r IN 
              SELECT typname, nspname 
              FROM pg_type t
              JOIN pg_namespace n ON t.typnamespace = n.oid
              WHERE n.nspname = 'public'
              AND t.typtype = 'c'
              AND t.typname LIKE 'kublai_%'
            LOOP
              BEGIN
                EXECUTE 'DROP TYPE IF EXISTS ' || quote_ident(r.nspname) || '.' || quote_ident(r.typname) || ' CASCADE';
              EXCEPTION WHEN OTHERS THEN
                NULL;
              END;
            END LOOP;
          END $$;
        `);

        // Retry db:push
        const { stdout: retryStdout, stderr: retryStderr } =
          await execAsync("pnpm db:push");
        if (retryStdout) console.log(retryStdout);
        if (retryStderr && !retryStderr.includes("duplicate key")) {
          console.error(retryStderr);
        }
      }
    } catch (error) {
      // If db:push fails, log but continue - tables might already exist
      if (error instanceof Error && error.message.includes("duplicate key")) {
        console.log(
          "   ⚠️  db:push encountered type conflicts, but continuing...",
        );
        console.log(
          "   ℹ️  This is usually safe - types may already exist from previous runs",
        );
      } else {
        throw error;
      }
    }

    console.log("✅ Migrations completed successfully!");
  } catch (error) {
    console.error("❌ Error running migrations:", error);
    throw error;
  }
}

export async function syncUsersFromClerk(database?: DrizzleDb) {
  try {
    const dbToUse = database ?? (await getDb());
    const clerkUsers = await fetchAllClerkUsers();

    if (clerkUsers.length === 0) {
      console.log("No users found in Clerk to sync");
      return;
    }

    console.log(`Syncing ${clerkUsers.length} users to database...`);

    let synced = 0;
    let updated = 0;
    let created = 0;

    for (const clerkUser of clerkUsers) {
      const email = clerkUser.email_addresses?.[0]?.email_address ?? "";
      const name =
        clerkUser.first_name && clerkUser.last_name
          ? `${clerkUser.first_name} ${clerkUser.last_name}`
          : (clerkUser.first_name ?? clerkUser.last_name ?? null);

      // Check if user already exists
      const existingUser = await dbToUse
        .select()
        .from(users)
        .where(eq(users.id, clerkUser.id))
        .limit(1);

      if (existingUser.length > 0) {
        // Update existing user
        await dbToUse
          .update(users)
          .set({
            name: name ?? null,
            email: email,
            image: clerkUser.image_url ?? null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, clerkUser.id));
        updated++;
      } else {
        // Create new user
        await dbToUse.insert(users).values({
          id: clerkUser.id,
          name: name ?? null,
          email: email,
          image: clerkUser.image_url ?? null,
          role: "user",
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        created++;
      }
      synced++;
    }

    console.log(
      `Successfully synced ${synced} users (${created} created, ${updated} updated)`,
    );
  } catch (error) {
    console.error("Error syncing users from Clerk:", error);
    // Don't throw - allow the script to continue even if sync fails
    // This way the database is still cleared even if Clerk API is unavailable
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase();
      if (
        errorMessage.includes("does not exist") ||
        errorMessage.includes("relation") ||
        errorMessage.includes("table")
      ) {
        console.error(
          "\n⚠️  Database tables don't exist yet. Please run migrations first:",
        );
        console.error("   pnpm db:push");
        console.error(
          "\n   Then you can manually sync users by running this script again, or",
        );
        console.error(
          "   users will be synced automatically via Clerk webhooks on next sign-in.",
        );
      } else {
        console.error(error.message);
      }
    }
  }
}

export async function ensureDatabaseExists() {
  console.log("🔍 Checking if database exists...");

  // Validate DATABASE_URL format
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL environment variable is not set. Please check your .env file.",
    );
  }

  let dbUrl: URL;
  try {
    dbUrl = new URL(env.DATABASE_URL);
  } catch (error) {
    throw new Error(
      `Invalid DATABASE_URL format: ${env.DATABASE_URL}\n` +
        `Expected format: postgresql://user:password@host:port/database`,
    );
  }

  // Parse DATABASE_URL to get connection info without the database name
  const dbName = dbUrl.pathname.slice(1).split("?")[0]; // Remove leading / and query params

  if (!dbName) {
    throw new Error(
      `No database name found in DATABASE_URL: ${env.DATABASE_URL}\n` +
        `Expected format: postgresql://user:password@host:port/database\n` +
        `Please ensure your DATABASE_URL includes a database name (e.g., /kublai)`,
    );
  }

  // Validate database name format
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(dbName)) {
    throw new Error(
      `Invalid database name: "${dbName}"\n` +
        `Database names must start with a letter or underscore and contain only letters, numbers, and underscores.`,
    );
  }

  // Connect to postgres database to create the target database if needed
  // Build admin URL by replacing the database name with "postgres"
  const adminUrl = env.DATABASE_URL?.replace(`/${dbName}`, "/postgres").split(
    "?",
  )[0];
  if (!adminUrl) {
    throw new Error("DATABASE_URL is not defined");
  }
  console.log(`   Connecting to admin database to check/create "${dbName}"...`);

  let adminConn: postgres.Sql;
  try {
    adminConn = postgres(adminUrl, { max: 1 });
  } catch (error) {
    throw new Error(
      `Failed to connect to PostgreSQL server.\n` +
        `Please ensure:\n` +
        `  1. PostgreSQL is running\n` +
        `  2. DATABASE_URL is correct: ${env.DATABASE_URL}\n` +
        `  3. Database server is accessible\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    // Check if database exists
    const result = await adminConn.unsafe(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [dbName],
    );

    if (!result || result.length === 0) {
      console.log(`📦 Creating database "${dbName}"...`);
      try {
        await adminConn.unsafe(`CREATE DATABASE "${dbName}";`);
        console.log(`✅ Database "${dbName}" created successfully!`);
        console.log(
          `\n⚠️  NOTE: Using separate database "${dbName}" to avoid conflicts with other Drizzle applications.`,
        );
        console.log(
          `   If you need to share a database, you'll need to coordinate schema usage.`,
        );
      } catch (createError) {
        // If database creation fails, it might already exist (race condition)
        // or there might be a permissions issue
        const errorMessage =
          createError instanceof Error
            ? createError.message
            : String(createError);
        if (
          errorMessage.includes("already exists") ||
          errorMessage.includes("duplicate key") ||
          errorMessage.includes("pg_database_datname_index")
        ) {
          // Database was created by another concurrent call - this is fine
          console.log(
            `✓ Database "${dbName}" already exists (created by another process)`,
          );
        } else {
          throw new Error(
            `Failed to create database "${dbName}".\n` +
              `Error: ${errorMessage}\n` +
              `Please ensure you have CREATE DATABASE permissions.`,
          );
        }
      }
    } else {
      console.log(`✓ Database "${dbName}" already exists`);
    }
  } catch (error) {
    await adminConn.end();
    console.error(`❌ Error ensuring database exists:`, error);
    // Re-throw the error so the caller knows it failed
    throw error;
  }

  await adminConn.end();
  console.log("✅ Database check complete");
}

export async function clearDatabase(database?: DrizzleDb) {
  console.log("Clearing database...");

  try {
    // Ensure database exists before trying to connect
    if (!database) {
      await ensureDatabaseExists();
    }

    // Get database connection if not provided
    const dbToUse = database ?? (await getDb());

    // Drop all kublai_ prefixed tables using a single SQL statement
    // This approach only touches kublai_ prefixed tables and preserves other tables
    await dbToUse.execute(sql`
      DO $$ 
      DECLARE 
        r RECORD;
        table_count INTEGER := 0;
      BEGIN
        FOR r IN 
          SELECT tablename 
          FROM pg_tables 
          WHERE schemaname = 'public' 
          AND tablename LIKE 'kublai_%'
        LOOP
          EXECUTE 'DROP TABLE IF EXISTS "' || r.tablename || '" CASCADE';
          table_count := table_count + 1;
        END LOOP;
        
        IF table_count > 0 THEN
          RAISE NOTICE 'Dropped % kublai_ tables', table_count;
        ELSE
          RAISE NOTICE 'No kublai_ tables found to drop';
        END IF;
      END $$;
    `);

    console.log("Database cleared successfully!");
  } catch (error) {
    console.error("Error clearing database:", error);
    throw error;
  }
}

export async function seedPlumbing(
  shouldClearFirst = false,
  shouldRunMigrations = false,
  database?: DrizzleDb,
) {
  console.log("🔧 Starting plumbing parts seed...");

  // Use provided database or create a new connection
  // If database is not provided, we need to create a new connection after ensuring DB exists
  let dbToUse: DrizzleDb;
  let createdConnection: postgres.Sql | null = null;

  try {
    // Ensure database exists before any connections
    // This must be called before creating any database connections
    await ensureDatabaseExists();

    if (database) {
      dbToUse = database;
    } else {
      // Create a fresh connection now that we know the database exists
      createdConnection = postgres(env.DATABASE_URL);
      dbToUse = drizzle(createdConnection);
    }

    // Optionally clear the entire database first (full schema drop)
    if (shouldClearFirst) {
      console.log("🗑️  Clearing entire database...");
      await clearDatabase(dbToUse);
      console.log("✅ Database cleared successfully!");
    }

    // Run migrations if requested (always needed after clearing, or if explicitly requested)
    if (shouldRunMigrations || shouldClearFirst) {
      console.log("Running migrations...");
      await runMigrations(dbToUse);
    }

    // Step 1: Create or get units FIRST (before any clearing that might delete them)
    console.log("📏 Creating units...");
    const unitMap = new Map<string, string>();

    for (const unitDef of unitDefinitions) {
      // Always check database for current state
      const [existing] = await dbToUse
        .select()
        .from(units)
        .where(eq(units.code, unitDef.code))
        .limit(1);

      if (existing) {
        unitMap.set(unitDef.code, existing.id);
        console.log(`   ✓ Unit "${unitDef.code}" already exists`);
      } else {
        const [newUnit] = await dbToUse
          .insert(units)
          .values(unitDef)
          .returning({ id: units.id });
        if (newUnit) {
          unitMap.set(unitDef.code, newUnit.id);
          console.log(`   ✓ Created unit "${unitDef.code}"`);
        } else {
          throw new Error(`Failed to create unit "${unitDef.code}"`);
        }
      }
    }

    // Verify all required units exist
    if (unitMap.size !== unitDefinitions.length) {
      throw new Error(
        `Expected ${unitDefinitions.length} units but only found ${unitMap.size}. ` +
          `Missing: ${unitDefinitions
            .filter((u) => !unitMap.has(u.code))
            .map((u) => u.code)
            .join(", ")}`,
      );
    }

    // Clear existing plumbing seed data in correct order (respecting foreign key constraints)
    // Skip if we just cleared the entire database (tables don't exist yet)
    // NOTE: We do this AFTER creating units so units are available and won't be deleted
    if (!shouldClearFirst) {
      console.log("🗑️  Clearing existing plumbing seed data...");
      // Use raw SQL to avoid import issues and respect foreign key constraints
      // Delete in order: supplier_parts -> part_synonyms -> part_definitions -> suppliers -> locations -> categories
      // NOTE: We DON'T delete units here since we just created/verified them above
      await dbToUse.execute(sql`DELETE FROM kublai_supplier_part`);
      await dbToUse.execute(sql`DELETE FROM kublai_part_synonym`);
      await dbToUse.execute(
        sql`DELETE FROM kublai_part_definition WHERE "organizationId" IS NULL`,
      );
      await dbToUse.execute(sql`DELETE FROM kublai_supplier`);
      await dbToUse.execute(sql`DELETE FROM kublai_location`);
      await dbToUse.execute(
        sql`DELETE FROM kublai_category WHERE "organizationId" IS NULL`,
      );
      // Note: We don't delete organizations here as they might be used by other parts of the system
      // Only delete the seed test organization if it exists
      await dbToUse.execute(
        sql`DELETE FROM kublai_organization WHERE name = 'Seed Test Organization'`,
      );
      console.log("✅ Cleared all existing plumbing seed data");
    }

    for (const unitDef of unitDefinitions) {
      const [existing] = await dbToUse
        .select()
        .from(units)
        .where(eq(units.code, unitDef.code))
        .limit(1);

      if (existing) {
        unitMap.set(unitDef.code, existing.id);
        console.log(`   ✓ Unit "${unitDef.code}" already exists`);
      } else {
        const [newUnit] = await dbToUse
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
      const [existingParent] = await dbToUse
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
        const [newParent] = await dbToUse
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
          // If creation failed, try to get the existing one (might have been created concurrently)
          const [retryParent] = await dbToUse
            .select()
            .from(categories)
            .where(
              and(
                eq(categories.name, parentCat.name),
                isNull(categories.organizationId),
              ),
            )
            .limit(1);
          if (retryParent) {
            parentId = retryParent.id;
            console.log(
              `   ✓ Category "${parentCat.name}" found (created by another process)`,
            );
          } else {
            throw new Error(`Failed to create category ${parentCat.name}`);
          }
        }
      }

      // Verify parentId is set before proceeding
      if (!parentId) {
        throw new Error(`Parent category "${parentCat.name}" has no ID`);
      }

      categoryMap.set(parentCat.name, parentId);

      // Create child categories
      for (const childCat of parentCat.children) {
        const fullName = `${parentCat.name} > ${childCat.name}`;
        const [existingChild] = await dbToUse
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
          // Verify parent still exists before creating child
          let parentCheck = await dbToUse
            .select()
            .from(categories)
            .where(eq(categories.id, parentId))
            .limit(1);

          // If parent was deleted (race condition), recreate it
          if (!parentCheck || parentCheck.length === 0) {
            console.log(
              `   ⚠️  Parent category "${parentCat.name}" was deleted, recreating...`,
            );
            const [recreatedParent] = await dbToUse
              .insert(categories)
              .values({
                name: parentCat.name,
                organizationId: null,
                parentId: null,
                sortOrder: 0,
              })
              .returning({ id: categories.id });
            if (recreatedParent) {
              parentId = recreatedParent.id;
              categoryMap.set(parentCat.name, parentId);
              console.log(`   ✓ Recreated parent category "${parentCat.name}"`);
            } else {
              throw new Error(
                `Failed to recreate parent category "${parentCat.name}" after it was deleted`,
              );
            }
          }

          const [newChild] = await dbToUse
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
            // If creation failed, try to get existing one
            const [retryChild] = await dbToUse
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
            if (retryChild) {
              childCategoryId = retryChild.id;
              console.log(
                `   ✓ Category "${fullName}" found (created by another process)`,
              );
            } else {
              throw new Error(`Failed to create category ${fullName}`);
            }
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
      // Get category ID from map, but verify it still exists in database
      let categoryId = categoryMap.get(partData.categoryName);
      if (!categoryId) {
        // Category not in map, try to find it in database
        const [foundCategory] = await dbToUse
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.name, partData.categoryName),
              isNull(categories.organizationId),
            ),
          )
          .limit(1);
        if (foundCategory?.id) {
          const newCategoryId = foundCategory.id;
          categoryId = newCategoryId;
          categoryMap.set(partData.categoryName, newCategoryId);
          console.log(
            `   ℹ️  Found category "${partData.categoryName}" in database`,
          );
        } else {
          console.warn(
            `   ⚠️  Category "${partData.categoryName}" not found, skipping part`,
          );
          continue;
        }
      }

      // Verify category still exists in database (might have been deleted)
      const [categoryCheck] = await dbToUse
        .select()
        .from(categories)
        .where(eq(categories.id, categoryId))
        .limit(1);

      if (!categoryCheck) {
        // Category was deleted, try to find it again by name
        console.log(
          `   ⚠️  Category "${partData.categoryName}" (${categoryId}) was deleted, looking it up again...`,
        );
        const [refreshedCategory] = await dbToUse
          .select()
          .from(categories)
          .where(
            and(
              eq(categories.name, partData.categoryName),
              isNull(categories.organizationId),
            ),
          )
          .limit(1);

        if (refreshedCategory?.id) {
          const newCategoryId = refreshedCategory.id;
          categoryId = newCategoryId;
          categoryMap.set(partData.categoryName, newCategoryId);
          console.log(
            `   ✓ Found category "${partData.categoryName}" with new ID`,
          );
        } else {
          console.warn(
            `   ⚠️  Category "${partData.categoryName}" not found in database, skipping part`,
          );
          continue;
        }
      }

      // Verify units exist before using them
      const sizeUnitId = partData.sizeUnit
        ? (() => {
            const unitId = unitMap.get(partData.sizeUnit);
            if (!unitId) {
              throw new Error(
                `Unit "${partData.sizeUnit}" not found in unitMap. Available units: ${Array.from(unitMap.keys()).join(", ")}`,
              );
            }
            // Verify unit still exists in database
            return unitId;
          })()
        : null;
      const defaultUomId = (() => {
        const unitId = unitMap.get("ea");
        if (!unitId) {
          throw new Error(
            'Unit "ea" not found in unitMap. This is required for default UOM.',
          );
        }
        return unitId;
      })();

      // Check if part already exists
      const [existing] = await dbToUse
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
        const [newPart] = await dbToUse
          .insert(partDefinitions)
          .values({
            organizationId: null, // Global parts
            categoryId: categoryId,
            displayName: partData.displayName,
            description: partData.description,
            imageUrl: null, // Can be added later
            partType: partData.partType,
            material: partData.material,
            sizeNominal: partData.sizeNominal?.toString() ?? null,
            lastKnownUnitCost:
              parseFloat(partData.lastKnownUnitCost?.toFixed(2) ?? "0.00") ??
              null,
            currency: partData.currency ?? "$",
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
        const [existingSynonym] = await dbToUse
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
          await dbToUse.insert(partSynonyms).values({
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
    const [existingOrg] = await dbToUse
      .select()
      .from(organizations)
      .where(eq(organizations.name, orgName))
      .limit(1);

    let organizationId: string;
    if (existingOrg) {
      organizationId = existingOrg.id;
      console.log(`   ✓ Organization "${orgName}" already exists`);
    } else {
      try {
        const [newOrg] = await dbToUse
          .insert(organizations)
          .values({
            name: orgName,
          })
          .returning({ id: organizations.id });
        if (newOrg) {
          organizationId = newOrg.id;
          console.log(`   ✓ Created organization "${orgName}"`);
        } else {
          // If insert returned nothing, try to find it (might have been created concurrently)
          const [retryOrg] = await dbToUse
            .select()
            .from(organizations)
            .where(eq(organizations.name, orgName))
            .limit(1);
          if (retryOrg) {
            organizationId = retryOrg.id;
            console.log(
              `   ✓ Organization "${orgName}" found (created by another process)`,
            );
          } else {
            throw new Error("Failed to create organization");
          }
        }
      } catch (error) {
        // If duplicate key error, organization was created by another process
        if (
          error instanceof Error &&
          (error.message.includes("duplicate key") ||
            error.message.includes("23505"))
        ) {
          const [retryOrg] = await dbToUse
            .select()
            .from(organizations)
            .where(eq(organizations.name, orgName))
            .limit(1);
          if (retryOrg) {
            organizationId = retryOrg.id;
            console.log(
              `   ✓ Organization "${orgName}" found (created by another process)`,
            );
          } else {
            throw new Error(
              `Organization "${orgName}" duplicate key error but not found in database`,
            );
          }
        } else {
          throw error;
        }
      }
    }

    // Step 4.5: Create locations
    console.log("\n📍 Creating locations...");
    const locationMap = new Map<string, string>();
    let locationsCreated = 0;

    for (const locationData of locationDefinitions) {
      const [existing] = await dbToUse
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
        const [newLocation] = await dbToUse
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

      const [existing] = await dbToUse
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
          await dbToUse
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
        const [newSupplier] = await dbToUse
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
      const allParts = await dbToUse
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
        const existingSupplierParts = await dbToUse
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

              await dbToUse.insert(supplierParts).values({
                organizationId: organizationId,
                supplierId: randomSupplierId,
                partDefinitionId: part.id,
                supplierSku: `${sku}-${Math.floor(Math.random() * 1000)}`,
                supplierName: part.displayName,
                packSize: "1",
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
    const allSupplierParts = await dbToUse
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
      const [partDef] = await dbToUse
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

        await dbToUse
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
  } finally {
    // Close the connection if we created it
    if (createdConnection) {
      try {
        await createdConnection.end();
      } catch (e) {
        // Ignore errors when closing
      }
    }
  }
}

async function main() {
  try {
    // Clear the database
    await clearDatabase();

    // Run migrations to recreate tables
    await runMigrations();

    // Seed plumbing data
    await seedPlumbing(false, false); // Don't clear again, don't run migrations again

    // Sync users from Clerk (after migrations ensure tables exist)
    await syncUsersFromClerk();

    console.log("\n✅ Done!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    const dbInstance = await getDb();
    await dbInstance.$client.end();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
