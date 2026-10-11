import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "~/server/db";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { assertEstimateAccess } from "./service";

export async function requireEstimatingPage() {
  const identity = await getRequestIdentity(await headers(), {
    allowDev: true,
  });
  if (!identity.userId || !identity.user) redirect("/sign-in");
  try {
    assertEstimateAccess({
      db,
      user: identity.user,
      userId: identity.userId,
      actorUser: identity.actorUser,
      simulation: identity.simulation,
    });
  } catch {
    redirect("/dashboard");
  }
}
