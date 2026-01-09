import "dotenv/config";
import { db } from "../src/server/db";
import { sql } from "drizzle-orm";
import { users } from "../src/server/db/schema";
import { eq } from "drizzle-orm";

// Type for drizzle database instance
type DrizzleDb = typeof db;

const CLERK_API_URL = "https://api.clerk.com/v1";

interface ClerkUser {
  id: string;
  email_addresses: Array<{ email_address: string; id: string }>;
  first_name: string | null;
  last_name: string | null;
  image_url: string | null;
}

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

export async function syncUsersFromClerk(database: DrizzleDb = db) {
  try {
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
      const existingUser = await database
        .select()
        .from(users)
        .where(eq(users.id, clerkUser.id))
        .limit(1);

      if (existingUser.length > 0) {
        // Update existing user
        await database
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
        await database.insert(users).values({
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

export async function clearDatabase(database: DrizzleDb = db) {
  console.log("Clearing database...");

  try {
    // Drop all tables with the kublai_ prefix
    await database.execute(
      sql`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO postgres; GRANT ALL ON SCHEMA public TO public;`,
    );

    console.log("Database cleared successfully!");
    console.log(
      "\nNote: You may need to run migrations (pnpm db:push) before syncing users.",
    );
  } catch (error) {
    console.error("Error clearing database:", error);
    throw error;
  }
}

async function main() {
  try {
    // Clear the database
    await clearDatabase();

    // Sync users from Clerk
    await syncUsersFromClerk();

    console.log("\nDone!");
  } catch (error) {
    console.error("Error:", error);
    throw error;
  } finally {
    await db.$client.end();
    process.exit(0);
  }
}

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
