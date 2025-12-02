import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { boardRouter } from "~/server/api/routers/board";
import { creativeRouter } from "~/server/api/routers/creative";
import { paymentRouter } from "~/server/api/routers/payment";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  payment: paymentRouter,
  board: boardRouter,
  creative: creativeRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;

/**
 * Create a server-side caller for the tRPC API.
 * @example
 * const trpc = createCaller(createContext);
 * const res = await trpc.yourRouter.yourProcedure();
 */
export const createCaller = createCallerFactory(appRouter);
