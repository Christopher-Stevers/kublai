/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */

import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { auth } from "@clerk/nextjs/server";
import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
  const { userId } = await auth();

  // Get user from database if authenticated
  let dbUser = null;
  if (userId) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    dbUser = user ?? null;
  }

  return {
    db,
    userId,
    user: dbUser,
    ...opts,
  };
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 *
 * You can remove this if you don't like it, but it can help catch unwanted waterfalls by simulating
 * network latency that would occur in production but not in local development.
 */
const timingMiddleware = t.middleware(async ({ next, path }) => {
  const start = Date.now();

  if (t._config.isDev) {
    // artificial delay in dev
    const waitMs = Math.floor(Math.random() * 400) + 100;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  const result = await next();

  const end = Date.now();
  console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

  return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);

/**
 * Protected (authenticated) procedure
 *
 * If you want a query or mutation to ONLY be accessible to logged in users, use this. It verifies
 * the user is authenticated and guarantees `ctx.userId` and `ctx.user` are not null.
 *
 * @see https://trpc.io/docs/procedures
 */
export const protectedProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found in database",
      });
    }
    return next({
      ctx: {
        // infers the `userId` and `user` as non-nullable
        userId: ctx.userId,
        user: ctx.user,
      },
    });
  });

/**
 * Admin procedure
 *
 * If you want a query or mutation to ONLY be accessible to admin users, use this. It verifies
 * the user is authenticated and has the "admin" role.
 */
export const adminProcedure = t.procedure
  .use(timingMiddleware)
  .use(({ ctx, next }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }
    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found in database",
      });
    }
    if (ctx.user.role !== "admin") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Admin access required",
      });
    }
    return next({
      ctx: {
        // infers the `userId` and `user` as non-nullable
        userId: ctx.userId,
        user: ctx.user,
      },
    });
  });

/**
 * Procedure that requires dashboard access (subscription or one-time purchase)
 * Checks if user has active subscription or one-time access
 */
export const hasDashboardAccess = t.procedure
  .use(timingMiddleware)
  .use(async ({ ctx, next }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: "UNAUTHORIZED" });
    }

    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found in database",
      });
    }

    // Admins always have access
    if (ctx.user.role === "admin") {
      return next({
        ctx: {
          userId: ctx.userId,
          user: ctx.user,
        },
      });
    }

    // Check for active subscription
    const hasActiveSubscription =
      ctx.user.stripeSubscriptionId &&
      ctx.user.subscriptionStatus === "active" &&
      (!ctx.user.subscriptionEndsAt ||
        new Date(ctx.user.subscriptionEndsAt) > new Date());

    // Check for one-time access
    const hasOneTimeAccess = ctx.user.hasOneTimeAccess === true;

    if (!hasActiveSubscription && !hasOneTimeAccess) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          "Dashboard access required. Please purchase a subscription or one-time access.",
      });
    }

    return next({
      ctx: {
        userId: ctx.userId,
        user: ctx.user,
      },
    });
  });
