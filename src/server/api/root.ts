import { supplierPriceBooksRouter } from "~/server/api/routers/supplierPriceBooks";
import { jobPricingRouter } from "~/server/api/routers/jobPricing";
import { modelsRouter } from "~/server/api/routers/models";
import { appDevicesRouter } from "~/server/api/routers/appDevices";
import { assetsRouter } from "~/server/api/routers/assets";
import { catalogueRouter } from "~/server/api/routers/catalogue";
import { chatRouter } from "~/server/api/routers/chat";
import { conversationsRouter } from "~/server/api/routers/conversations";
import { drawingsRouter } from "~/server/api/routers/drawings";
import { drawingsWorkspaceRouter } from "~/server/api/routers/drawingsWorkspace";
import { drawsRouter } from "~/server/api/routers/draws";
import { estimatingRouter } from "~/server/api/routers/estimating";
import { jobRouter } from "~/server/api/routers/job";
import { locationRouter } from "~/server/api/routers/location";
import { materialListRouter } from "~/server/api/routers/materialList";
import { notificationsRouter } from "~/server/api/routers/notifications";
import { orderDeliveryRouter } from "~/server/api/routers/orderDelivery";
import { organizationRouter } from "~/server/api/routers/organization";
import { paymentRouter } from "~/server/api/routers/payment";
import { prefabsRouter } from "~/server/api/routers/prefabs";
import { pushRouter } from "~/server/api/routers/push";
import { roomsRouter } from "~/server/api/routers/rooms";
import { supplierRouter } from "~/server/api/routers/supplier";
import { timesheetsRouter } from "~/server/api/routers/timesheets";
import { userRouter } from "~/server/api/routers/user";
import { createCallerFactory, createTRPCRouter } from "~/server/api/trpc";

/**
 * This is the primary router for your server.
 *
 * All routers added in /api/routers should be manually added here.
 */
export const appRouter = createTRPCRouter({
  models: modelsRouter,
  estimating: estimatingRouter,
  orderDelivery: orderDeliveryRouter,
  appDevices: appDevicesRouter,
  notifications: notificationsRouter,
  timesheets: timesheetsRouter,
  chat: chatRouter,
  conversations: conversationsRouter,
  push: pushRouter,
  payment: paymentRouter,
  user: userRouter,
  organization: organizationRouter,
  catalogue: catalogueRouter,
  supplier: supplierRouter,
  supplierPriceBooks: supplierPriceBooksRouter,
  job: jobRouter,
  jobPricing: jobPricingRouter,
  rooms: roomsRouter,
  materialList: materialListRouter,
  location: locationRouter,
  draws: drawsRouter,
  drawings: drawingsRouter,
  drawingsWorkspace: drawingsWorkspaceRouter,
  prefabs: prefabsRouter,
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
