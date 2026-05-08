import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const AGENT_AUTH_COOKIE = "foremenhq_agent_auth";
const AGENT_AUTH_HEADER = "x-foremenhq-agent-auth";

function hasAgentAuthBypass(req: NextRequest) {
  if (process.env.FOREMENHQ_AGENT_AUTH_BYPASS !== "true") return false;

  const expectedSecret = process.env.FOREMENHQ_AGENT_AUTH_SECRET?.trim() ?? "";
  if (expectedSecret.length < 32) return false;

  const providedToken =
    req.headers.get(AGENT_AUTH_HEADER)?.trim() ??
    req.cookies.get(AGENT_AUTH_COOKIE)?.value.trim() ??
    "";

  return providedToken === expectedSecret;
}

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  "/beta(.*)",
  "/api/health",
  "/api/catalogue/images(.*)",
  "/api/webhooks(.*)",
  "/api/auth(.*)",
]);

const clerkProtectedMiddleware = clerkMiddleware(async (auth, req) => {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  if (hasAgentAuthBypass(req)) {
    return NextResponse.next();
  }

  if (!isPublicRoute(req)) {
    const { userId } = await auth();

    if (!userId) {
      const signInUrl = new URL("/sign-in", req.url);
      return NextResponse.redirect(signInUrl);
    }
  }

  return NextResponse.next();
});

export default function middleware(
  req: NextRequest,
  evt: Parameters<typeof clerkProtectedMiddleware>[1],
) {
  return clerkProtectedMiddleware(req, evt);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
