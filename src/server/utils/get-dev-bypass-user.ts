import { asc, eq, isNotNull } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";

export async function getDevBypassUser() {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const preferredEmail = process.env.DEV_AUTH_EMAIL?.trim().toLowerCase();

  if (preferredEmail) {
    const [preferredUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, preferredEmail))
      .limit(1);

    if (preferredUser?.organizationId) {
      return preferredUser;
    }
  }

  const [fallbackUser] = await db
    .select()
    .from(users)
    .where(isNotNull(users.organizationId))
    .orderBy(asc(users.createdAt))
    .limit(1);

  return fallbackUser ?? null;
}
