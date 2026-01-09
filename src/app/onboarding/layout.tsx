import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";

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

  // Get user from database
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // If user doesn't exist, redirect to sign-in
  if (!user) {
    redirect("/sign-in");
  }

  // If user already has an organization, redirect to dashboard
  if (user.organizationId) {
    console.log(user.organizationId);
    redirect("/dashboard");
  }

  return <>{children}</>;
}
