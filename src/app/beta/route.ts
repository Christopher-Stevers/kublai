import { NextResponse, type NextRequest } from "next/server";

/** Old beta links remain usable, but can only lead to an individual sign-in. */
export function GET(request: NextRequest) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  let signInUrl = new URL("/sign-in", request.url);
  if (configuredOrigin) signInUrl = new URL("/sign-in", configuredOrigin);
  const response = NextResponse.redirect(signInUrl);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.delete("foremenhq_agent_auth");
  response.cookies.delete("foremenhq_beta_access");
  return response;
}
