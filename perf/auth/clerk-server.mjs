// This module is reachable only through the generated lab snapshot webpack alias.
import { NextResponse } from "next/server";
export async function auth() {
  return {
    userId: "perf-lab-user",
    sessionId: "perf-lab-session",
    orgId: null,
    protect: async () => ({ userId: "perf-lab-user" }),
    getToken: async () => null,
  };
}
// Refuse implicit user creation. The isolated database must contain the seed row.
export async function currentUser() {
  return null;
}
auth.protect = async () => ({ userId: "perf-lab-user" });
export function createRouteMatcher(patterns) {
  return (request) =>
    patterns.some((pattern) =>
      new RegExp(`^${pattern}$`).test(request.nextUrl.pathname),
    );
}
export function clerkMiddleware(handler) {
  return async (request) => {
    await handler(auth, request);
    return NextResponse.next();
  };
}
