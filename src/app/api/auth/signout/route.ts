import { NextResponse, type NextRequest } from "next/server";

import { getAuthenticatedIdentity } from "~/server/utils/get-request-identity";
import { endEmployeeSimulation } from "~/server/simulation/service";
import { SIMULATION_COOKIE } from "~/lib/employee-simulation";
import { AGENT_AUTH_COOKIE } from "~/server/utils/get-agent-bypass-user";

const BETA_MARKER_COOKIE = "foremenhq_beta_access";

function clearAccessCookies(response: NextResponse) {
  response.cookies.delete(SIMULATION_COOKIE);
  response.cookies.delete(AGENT_AUTH_COOKIE);
  response.cookies.delete(BETA_MARKER_COOKIE);
}

async function revokeSimulation(request?: Request) {
  if (!request?.headers.get("cookie")?.includes(SIMULATION_COOKIE + "="))
    return;
  try {
    const { user } = await getAuthenticatedIdentity(request.headers, {
      allowDev: true,
    });
    await endEmployeeSimulation(user, request.headers);
  } catch {
    // Logout still clears the device's access if the database is unavailable.
  }
}
export async function GET(request: NextRequest) {
  await revokeSimulation(request);
  const response = NextResponse.redirect(new URL("/sign-in", request.url));
  clearAccessCookies(response);
  return response;
}

export async function POST(request: Request) {
  await revokeSimulation(request);
  const response = NextResponse.json({ ok: true });
  clearAccessCookies(response);
  return response;
}
