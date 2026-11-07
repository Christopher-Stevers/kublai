import { currentUser } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";

export async function ensureUser(userId: string) {
  let [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  if (user) {
    return user;
  }

  const clerkUser = await currentUser();
  if (!clerkUser || clerkUser.id !== userId) {
    return null;
  }

  const email = clerkUser.emailAddresses?.[0]?.emailAddress ?? `${userId}@clerk.temp`;
  const name =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") ||
    clerkUser.firstName ||
    clerkUser.lastName ||
    null;
  const image = clerkUser.imageUrl ?? null;

  const [ensuredUser] = await db
    .insert(users)
    .values({
      id: userId,
      email,
      name,
      image,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email,
        name,
        image,
        updatedAt: new Date(),
      },
    })
    .returning();

  return ensuredUser ?? null;
}
