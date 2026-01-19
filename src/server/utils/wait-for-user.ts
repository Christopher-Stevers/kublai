import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * Wait for user to be created by webhook with polling
 * @param userId - Clerk user ID
 * @param maxWaitMs - Maximum time to wait in milliseconds (default: 5000ms)
 * @param pollIntervalMs - Interval between polls in milliseconds (default: 200ms)
 * @returns User if found, null if timeout
 */
export async function waitForUser(
  userId: string,
  maxWaitMs: number = 5000,
  pollIntervalMs: number = 200,
): Promise<typeof users.$inferSelect | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (user) {
      return user;
    }

    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout - user not created by webhook
  return null;
}
