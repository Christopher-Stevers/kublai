import { redirect } from "next/navigation";
import { HydrateClient } from "~/trpc/server";
import { auth } from "@clerk/nextjs/server";
import { Header } from "../_components/Header";
import { ensureUser } from "~/server/utils/ensure-user";
import { waitForUser } from "~/server/utils/wait-for-user";

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

  // Get user from database (webhook should have created it)
  let user = await ensureUser(userId);

  // If user doesn't exist, wait for webhook to create it (with timeout)
  // This ensures webhook is the single source of truth for user creation
  if (!user) {
    user = await waitForUser(userId, 3000, 250);
  }

  // If user still doesn't exist after waiting, redirect to onboarding
  // The onboarding page will also wait for the webhook
  if (!user) {
    redirect("/onboarding");
  }

  // CRITICAL: Check organizationId BEFORE any rendering
  // If no organizationId, redirect immediately
  if (!user.organizationId) {
    redirect("/onboarding");
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
