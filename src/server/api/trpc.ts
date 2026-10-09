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

import { userCan } from "~/server/auth/permissions";
import { redactFinancialValues } from "~/lib/financial-visibility";
import { db } from "~/server/db";
import { withQueryStats } from "~/server/db/query-stats";

import { getRequestIdentity } from "~/server/utils/get-request-identity";

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
export const createTRPCContext = async (opts: {
  headers: Headers;
  request?: Request;
}) => {
  const {
    userId,
    user: dbUser,
    actorUser,
    simulation,
  } = await getRequestIdentity(opts.headers, {
    allowDev: true,
    request: opts.request,
  });

  return {
    db,
    userId,
    user: dbUser,
    actorUser,
    simulation,
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

const SLOW_REQUEST_MS = 1500;

// Logs duration and database round trips; `scripts/trpc-timing-report.mjs`
// summarizes these lines from the service journal.
const timingMiddleware = t.middleware(async ({ next, path, type, ctx }) => {
  const start = Date.now();

  const audit =
    ctx.simulation && type === "mutation"
      ? await (
          await import("~/server/simulation/service")
        ).recordSimulationAction(ctx.simulation, path)
      : null;
  if (
    ctx.simulation &&
    ((path.startsWith("payment.") &&
      path !== "payment.getSubscriptionStatus") ||
      ["push.subscribe", "push.unsubscribe", "push.revokeDevice"].includes(
        path,
      ))
  ) {
    if (audit)
      await (
        await import("~/server/simulation/service")
      ).finishSimulationAction(audit, "failed");
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "End simulation before changing billing or device notifications.",
    });
  }
  const { result, stats } = await withQueryStats(() => next());
  if (audit) {
    try {
      await (
        await import("~/server/simulation/service")
      ).finishSimulationAction(audit, result.ok ? "succeeded" : "failed");
    } catch {
      console.warn(
        "Simulation action outcome could not update; the original audit entry is retained.",
      );
    }
  }

  const duration = Date.now() - start;
  const message = `[TRPC] ${path} took ${duration}ms to execute (${stats.count} queries)`;
  if (duration >= SLOW_REQUEST_MS) console.warn(`${message} [slow]`);
  else console.log(message);

  if (result.ok && ctx.user && !userCan(ctx.user, "financial.view")) {
    return { ...result, data: redactFinancialValues(result.data) };
  }
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
 * Procedure that requires dashboard access.
 * Standard accounts can use the dashboard; paid Executive Account permissions
 * are enforced by feature-level permission checks.
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

    if (!ctx.user.organizationId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Create or join an organization before using the dashboard.",
      });
    }

    if (
      ctx.user.organizationAccessStatus &&
      ctx.user.organizationAccessStatus !== "approved"
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your organization access is waiting for approval.",
      });
    }

    return next({
      ctx: {
        userId: ctx.userId,
        user: { ...ctx.user, organizationId: ctx.user.organizationId },
      },
    });
  });
