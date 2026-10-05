import { pushRouter } from "~/server/api/routers/push";
import { chatRouter } from "~/server/api/routers/chat";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";
import { assistRouter } from "~/server/api/routers/assist";
import { adminRouter } from "~/server/api/routers/admin";
import { assetsRouter } from "~/server/api/routers/assets";
import { catalogueRouter } from "~/server/api/routers/catalogue";
import { drawsRouter } from "~/server/api/routers/draws";
import { drawingsRouter } from "~/server/api/routers/drawings";
import { jobRouter } from "~/server/api/routers/job";
import { roomsRouter } from "~/server/api/routers/rooms";
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
  chat: chatRouter,
  push: pushRouter,
  assist: assistRouter,
  payment: paymentRouter,
  admin: adminRouter,
  user: userRouter,
  organization: organizationRouter,
  catalogue: catalogueRouter,
  supplier: supplierRouter,
  job: jobRouter,
  rooms: roomsRouter,
  materialList: materialListRouter,
  location: locationRouter,
  draws: drawsRouter,
  drawings: drawingsRouter,
  assets: assetsRouter,
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
