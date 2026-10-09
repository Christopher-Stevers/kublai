import { z } from "zod";
import {
  notificationCursor,
  notificationReadTarget,
} from "~/lib/app-notifications";
import {
  createTRPCRouter,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import {
  assertNotificationAccount,
  notificationAccount,
  notificationOverview,
  notificationPage,
  readNotifications,
} from "~/server/notifications/service";

const accountProcedure = protectedProcedure
  .input(z.object({ accountKey: z.string().max(512) }))
  .use(({ ctx, input, next }) => {
    assertNotificationAccount(ctx.user, input.accountKey);
    return next();
  });

export const notificationsRouter = createTRPCRouter({
  identity: publicProcedure
    .input(z.object({ sessionKey: z.string().max(255) }))
    .query(({ ctx }) => ({ accountKey: notificationAccount(ctx.user) })),
  overview: accountProcedure.query(({ ctx }) => notificationOverview(ctx)),
  list: accountProcedure
    .input(
      z.object({
        unreadOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(30),
        cursor: notificationCursor.nullish(),
      }),
    )
    .query(({ ctx, input }) => notificationPage(ctx, input)),
  read: accountProcedure
    .input(
      z.object({ targets: z.array(notificationReadTarget).min(1).max(200) }),
    )
    .mutation(({ ctx, input }) => readNotifications(ctx, input.targets)),
});
