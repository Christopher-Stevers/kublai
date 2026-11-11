import { getRequestIdentity } from "~/server/utils/get-request-identity";

export async function GET(request: Request) {
  const identity = await getRequestIdentity(request.headers, { allowDev: true });
  const user = identity.user;
  if (!identity.userId || !user?.organizationId ||
      (user.organizationAccessStatus && user.organizationAccessStatus !== "approved"))
    return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const account = `${user.organizationId}:${identity.userId}${identity.simulation ? `:simulation:${identity.simulation.id}` : ""}`;
  return Response.json({ account, build: process.env.NEXT_PUBLIC_BUILD_ID ?? null }, {
    headers: { "Cache-Control": "no-store, private", Vary: "Cookie" },
  });
}
