import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { waitForUser } from "~/server/utils/wait-for-user";

export default async function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  // If user is authenticated, redirect them away from sign-in page
  if (userId) {
    // Get user from database (webhook should have created it)
    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // If user exists and has organizationId, redirect to dashboard
    if (user?.organizationId) {
      redirect("/dashboard");
    }

    // If user exists but no organizationId, redirect to onboarding
    if (user && !user.organizationId) {
      redirect("/onboarding");
    }

    // If user doesn't exist in DB yet (webhook hasn't created them),
    // redirect to onboarding - the onboarding layout will wait for the webhook
    // This prevents showing sign-in page to authenticated users
    if (!user) {
      redirect("/onboarding");
    }
  }

  // User is not authenticated - show sign-in page
  return <>{children}</>;
}
