import { redirect } from "next/navigation";
import { HydrateClient } from "~/trpc/server";
import { auth } from "@clerk/nextjs/server";
import { Header } from "../_components/Header";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";

export default async function DashboardLayout({
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

  if (!user) {
    console.log(user);
    redirect("/sign-in");
  }

  // Admins always have access
  if (user.role !== "admin") {
    // Check for active subscription
    const hasActiveSubscription =
      user.stripeSubscriptionId &&
      user.subscriptionStatus === "active" &&
      (!user.subscriptionEndsAt ||
        new Date(user.subscriptionEndsAt) > new Date());

    // Check for one-time access
    const hasOneTimeAccess = user.hasOneTimeAccess === true;

    if (!hasActiveSubscription && !hasOneTimeAccess) {
      redirect("/pricing");
    }
  }

  return (
    <HydrateClient>
      <div className="flex min-h-screen flex-col bg-gray-50">
        <Header />
        <main className="flex-1">{children}</main>
      </div>
    </HydrateClient>
  );
}
