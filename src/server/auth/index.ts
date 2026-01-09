import { auth as clerkAuth } from "@clerk/nextjs/server";

/**
 * Server-side auth function using Clerk
 * Use this in server components, API routes, and server actions
 */
export const auth = clerkAuth;
