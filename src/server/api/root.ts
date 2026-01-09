import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { adminRouter } from "~/server/api/routers/admin";
import { catalogueRouter } from "~/server/api/routers/catalogue";
import { locationRouter } from "~/server/api/routers/location";
import { materialListRouter } from "~/server/api/routers/materialList";
import { organizationRouter } from "~/server/api/routers/organization";
import { paymentRouter } from "~/server/api/routers/payment";
import { supplierRouter } from "~/server/api/routers/supplier";
import { userRouter } from "~/server/api/routers/user";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  payment: paymentRouter,
  admin: adminRouter,
  user: userRouter,
  organization: organizationRouter,
  catalogue: catalogueRouter,
  supplier: supplierRouter,
  materialList: materialListRouter,
  location: locationRouter,
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
