import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { waitForUser } from "~/server/utils/wait-for-user";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  // Redirect if not authenticated
  if (!userId) {
    redirect("/sign-in");
  }

  // Get user from database (webhook should have created it)
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // If user doesn't exist, wait for webhook to create it (with timeout)
  // This ensures webhook is the single source of truth for user creation
  if (!user) {
    user = await waitForUser(userId, 5000, 200); // Wait up to 5 seconds, poll every 200ms
  }

  // If user still doesn't exist after waiting, redirect to sign-in
  // This shouldn't happen if webhook is working, but handle gracefully
  if (!user) {
    redirect("/sign-in");
  }

  // If user already has an organization, redirect to dashboard
  if (user.organizationId) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}


