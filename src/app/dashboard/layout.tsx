import { SupplierLabelProvider } from "~/components/suppliers/SupplierLabelProvider";
import { snapshotSourceSchema } from "~/lib/snapshot-source";
import { LandingPageProvider } from "~/components/app/LandingPageProvider";
import { DrawingDestinationProvider } from "~/components/jobs/DrawingDestinationProvider";
import { SimulationProvider } from "~/components/simulation/SimulationProvider";
import { FinancialVisibilityProvider } from "~/components/permissions/FinancialVisibility";
import { DrawingsAccessProvider } from "~/components/permissions/DrawingsAccess";
import { userCan } from "~/server/auth/permissions";
import { TutorialGate } from "~/components/tutorial/TutorialGate";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { HydrateClient } from "~/trpc/server";
import { SnapshotProvider } from "~/components/chat/SnapshotProvider";
import { ChatViewProvider } from "~/components/chat/ChatViewProvider";
import { Header } from "../_components/Header";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { waitForUser } from "~/server/utils/wait-for-user";
import { ReplicacheSyncBootstrap } from "~/components/offline/ReplicacheSyncBootstrap";
import { TabAccessGate } from "./_components/TabAccessGate";
import { DrawingAccountProvider } from "~/components/jobs/DrawingAccountProvider";
import { AppKeyboardNavigation } from "~/components/app/AppKeyboardNavigation";

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
  user ??= (await waitForUser(effectiveUserId, 3000, 250)) as typeof user;

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
      <SimulationProvider
        simulation={identity.simulation}
        actorId={identity.actorUser?.id ?? effectiveUserId}
      >
        <TutorialGate
          key={effectiveUserId}
          userId={effectiveUserId}
          initialCompleted={!!user.tutorialCompletedAt}
        >
          <FinancialVisibilityProvider
            initialVisible={userCan(user, "financial.view")}
          >
            <DrawingsAccessProvider initialAllowed={userCan(user, "drawings.view")} initialCanUpload={userCan(user, "drawings.upload")} initialCanDelete={userCan(user, "drawings.delete")}>
            <DrawingAccountProvider
              userId={effectiveUserId}
              organizationId={organizationId}
              simulationId={identity.simulation?.id}
            >
              <SnapshotProvider>
                <DrawingDestinationProvider>
                  <LandingPageProvider key={effectiveUserId} userId={effectiveUserId} initial={snapshotSourceSchema.safeParse(user.defaultLandingPage).data ?? null}>
                  <div data-app-shell className="bg-canvas flex min-h-screen flex-col">
                    <AppKeyboardNavigation />
                    <ReplicacheSyncBootstrap
                      userId={effectiveUserId}
                      organizationId={organizationId}
                    />
                    <Header />
                    <TabAccessGate />
                    <main className="flex-1">
                      <ChatViewProvider key={`${organizationId}:${effectiveUserId}:${identity.simulation?.id ?? ""}`} scope={`${organizationId}:${effectiveUserId}:${identity.simulation?.id ?? ""}`}>
                        <SupplierLabelProvider>{children}</SupplierLabelProvider>
                      </ChatViewProvider>
                    </main>
                  </div>
                </LandingPageProvider>
                </DrawingDestinationProvider>
              </SnapshotProvider>
            </DrawingAccountProvider>
            </DrawingsAccessProvider>
          </FinancialVisibilityProvider>
        </TutorialGate>
      </SimulationProvider>
    </HydrateClient>
  );
}
