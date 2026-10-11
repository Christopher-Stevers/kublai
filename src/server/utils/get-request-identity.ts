import { auth } from "@clerk/nextjs/server";

import { ensureUser } from "~/server/utils/ensure-user";
import { getDevBypassUser } from "~/server/utils/get-dev-bypass-user";

// The legacy user table has circular Drizzle inference. Keep that `any` at the
// database boundary rather than spreading it into every authenticated caller.
export type RequestUser = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string | null;
  permissionConfig: unknown;
  permissionPresetId?: string | null;
  organizationAccessStatus: string | null;
  organizationId: string | null;
  pricingProfileId: string | null;
  stripeCustomerId: string | null;
  hasOneTimeAccess: boolean | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionEndsAt: Date | null;
  oneTimePurchaseDate: Date | null;
  currentJobId: string | null;
  tutorialCompletedAt: Date | null;
  tutorialOutcome: "completed" | "skipped" | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Shared tokens and legacy beta cookies never establish an application identity. */
export async function getAuthenticatedIdentity(
  _headers: Headers,
  options: { allowDev?: boolean } = {},
) {
  const { userId } = await auth();
  if (userId)
    return { userId, user: (await ensureUser(userId)) as RequestUser | null };

  const user =
    options.allowDev && process.env.NODE_ENV !== "production"
      ? ((await getDevBypassUser()) as RequestUser | null)
      : null;
  return { userId: user?.id ?? null, user };
}

export async function getRequestIdentity(
  headers: Headers,
  options: { allowDev?: boolean; request?: Request } = {},
) {
  const identity = await getAuthenticatedIdentity(headers, options);
  let simulation:
    | import("~/lib/employee-simulation").EmployeeSimulation
    | null = null;
  let user = identity.user;
  // Keep ordinary requests independent of the session database and its migrations.
  const cookie = headers.get("cookie") ?? "";
  const expectedView = headers.get("x-foremanhq-session-view");
  if (cookie.includes("foremanhq_employee_simulation=") || expectedView) {
    const {
      resolveEmployeeSimulation,
      assertSimulationView,
      recordSimulationAction,
    } = await import("~/server/simulation/service");
    const resolved = await resolveEmployeeSimulation(headers, identity.user);
    simulation = resolved?.simulation ?? null;
    user = resolved?.employee ?? identity.user;
    assertSimulationView(headers, identity.user, simulation);
    if (
      simulation &&
      options.request &&
      !["GET", "HEAD", "OPTIONS"].includes(options.request.method) &&
      !/^\/api\/replicache\/[^/]+\/pull$/.test(
        new URL(options.request.url).pathname,
      )
    )
      await recordSimulationAction(
        simulation,
        `${options.request.method} ${new URL(options.request.url).pathname}`,
      );
  }
  return {
    userId: simulation ? (user?.id ?? null) : identity.userId,
    user,
    actorUser: identity.user,
    simulation,
  };
}
