import "dotenv/config";

import { eq, sql } from "drizzle-orm";

import { db } from "../src/server/db";
import { partDefinitions } from "../src/server/db/schema";

const PLACEHOLDER_URL = "/images/plumbing-part-placeholder-v2.jpg";

async function main() {
  const before = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(partDefinitions)
    .where(eq(partDefinitions.imageUrl, PLACEHOLDER_URL));

  const updated = await db
    .update(partDefinitions)
    .set({ imageUrl: PLACEHOLDER_URL })
    .returning({ id: partDefinitions.id });

  const after = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(partDefinitions)
    .where(eq(partDefinitions.imageUrl, PLACEHOLDER_URL));

  console.log(
    JSON.stringify(
      {
        placeholderUrl: PLACEHOLDER_URL,
        updatedCount: updated.length,
        beforePlaceholderCount: before[0]?.count ?? 0,
        afterPlaceholderCount: after[0]?.count ?? 0,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("Failed to set generic part placeholder", error);
    process.exit(1);
  })
  .finally(async () => {
    process.exit(0);
  });
