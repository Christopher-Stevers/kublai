import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HydrateClient } from "~/trpc/server";
import { auth } from "@clerk/nextjs/server";
import { Header } from "../_components/Header";
import { ensureUser } from "~/server/utils/ensure-user";
import { waitForUser } from "~/server/utils/wait-for-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";
import { getAgentBypassUser } from "~/server/utils/get-agent-bypass-user";
import { ReplicacheSyncBootstrap } from "~/components/offline/ReplicacheSyncBootstrap";
import { TabAccessGate } from "./_components/TabAccessGate";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId: clerkUserId } = await auth();
  let userId = clerkUserId;

  // Redirect if not authenticated
  if (!userId) {
    const requestHeaders = await headers();
    const bypassUser =
      (await getAgentBypassUser(requestHeaders)) ?? (await getDevBypassUser());
    if (!bypassUser) {
      redirect("/sign-in");
    }
    userId = bypassUser.id;
  }

  const effectiveUserId = userId;
  if (!effectiveUserId) {
    redirect("/sign-in");
  }

  // Get user from database (webhook should have created it)
  let user = await ensureUser(effectiveUserId);

  // If user doesn't exist, wait for webhook to create it (with timeout)
  // This ensures webhook is the single source of truth for user creation
  if (!user) {
    user = await waitForUser(effectiveUserId, 3000, 250);
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

  if (
    user.organizationAccessStatus &&
    user.organizationAccessStatus !== "approved"
  ) {
    redirect("/pending-approval");
  }

  return (
    <HydrateClient>
      <div className="flex min-h-screen flex-col bg-gray-50">
        <ReplicacheSyncBootstrap />
        <Header />
        <TabAccessGate />
        <main className="flex-1">{children}</main>
      </div>
    </HydrateClient>
  );
}
