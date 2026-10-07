import { TutorialGate } from "~/components/tutorial/TutorialGate";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HydrateClient } from "~/trpc/server";
import { Header } from "../_components/Header";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { waitForUser } from "~/server/utils/wait-for-user";
import { ReplicacheSyncBootstrap } from "~/components/offline/ReplicacheSyncBootstrap";
import { TabAccessGate } from "./_components/TabAccessGate";
import { DrawingAccountProvider } from "~/components/jobs/DrawingAccountProvider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const identity = await getRequestIdentity(await headers(), {
    allowDev: true,
  });
  const effectiveUserId = identity.userId;
  if (!effectiveUserId) redirect("/sign-in");

  let user = identity.user;

  // If user doesn't exist, wait for webhook to create it (with timeout)
  // This ensures webhook is the single source of truth for user creation
  if (!user) {
    user = (await waitForUser(effectiveUserId, 3000, 250)) as typeof user;
  }

  // If user still doesn't exist after waiting, redirect to onboarding
  // The onboarding page will also wait for the webhook
  if (!user) {
    redirect("/onboarding");
  }

  // CRITICAL: Check organizationId BEFORE any rendering
  // If no organizationId, redirect immediately
  const organizationId = (user as { organizationId?: unknown }).organizationId;
  if (typeof organizationId !== "string" || !organizationId) {
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
      <TutorialGate
        key={effectiveUserId}
        userId={effectiveUserId}
        initialCompleted={!!user.tutorialCompletedAt}
      >
        <DrawingAccountProvider userId={effectiveUserId} organizationId={organizationId}>
        <div className="bg-muted/50 flex min-h-screen flex-col">
          <ReplicacheSyncBootstrap
            userId={effectiveUserId}
            organizationId={organizationId}
          />
          <Header />
          <TabAccessGate />
          <main className="flex-1">{children}</main>
        </div>
        </DrawingAccountProvider>
      </TutorialGate>
    </HydrateClient>
  );
}
