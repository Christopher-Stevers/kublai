import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  "/beta(.*)",
  "/join(.*)",
  "/api/health",
  "/api/catalogue/images(.*)",
  "/api/webhooks(.*)",
  "/api/auth(.*)",
]);

const clerkProtectedMiddleware = clerkMiddleware(async (auth, req) => {
  if (process.env.NODE_ENV !== "production") {
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
  // Database health must not depend on Clerk initialization/proxy availability.
  // Application requests, including QA, use normal Clerk authentication.
  // WOPI callbacks authenticate with scoped tokens and Collabora proof signatures.
  // Launch and blank-document endpoints still require normal application auth.
  if (
    req.nextUrl.pathname === "/api/health" ||
    /^\/api\/job-documents\/wopi\/[^/]+(?:\/contents)?$/.test(
      req.nextUrl.pathname,
    )
  )
    return NextResponse.next();
  return clerkProtectedMiddleware(req, evt);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
