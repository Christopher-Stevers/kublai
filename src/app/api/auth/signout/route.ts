import { NextResponse, type NextRequest } from "next/server";

import { AGENT_AUTH_COOKIE } from "~/server/utils/get-agent-bypass-user";

const BETA_MARKER_COOKIE = "foremenhq_beta_access";

function clearAccessCookies(response: NextResponse) {
  response.cookies.delete(AGENT_AUTH_COOKIE);
  response.cookies.delete(BETA_MARKER_COOKIE);
}

export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/sign-in", request.url));
  clearAccessCookies(response);
  return response;
}

export function POST() {
  const response = NextResponse.json({ ok: true });
  clearAccessCookies(response);
  return response;
}
