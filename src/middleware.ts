import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Define public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/pricing",
  "/api/webhooks(.*)",
  "/api/auth(.*)", // Allow Clerk auth routes (they redirect to /sign-in)
]);


export default clerkMiddleware(async (auth, req) => {
  if (process.env.NODE_ENV !== "production") {
    return NextResponse.next();
  }

  // Protect all routes except public ones
  if (!isPublicRoute(req)) {
    const { userId } = await auth();

    if (!userId) {
      // Use absolute URL for redirect in middleware
      const signInUrl = new URL("/sign-in", req.url);
      return NextResponse.redirect(signInUrl);
    }

    // Dashboard routes - let the layout handle organizationId checks
    // Middleware just ensures user is authenticated

    // Onboarding route is accessible to authenticated users without org
    // (handled by layout, not middleware)
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
