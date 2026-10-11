import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCan } from "~/server/auth/permissions";
import { deliveryCalendarSchema } from "~/lib/delivery-calendar";
import {
  deliveryCountries,
  deliveryHolidays,
  deliveryLocations,
  readDeliveryCalendar,
  saveDeliveryCalendar,
  scheduledDeliveryDate,
  validateDeliveryLocation,
} from "~/server/orders/delivery-calendar";

export const orderDeliveryRouter = createTRPCRouter({
  get: hasDashboardAccess.query(async ({ ctx }) => {
    assertCan(ctx.user, "orders.send");
    const saved = await readDeliveryCalendar(ctx.db, ctx.user.id);
    return { ...saved, userId: ctx.user.id };
  }),
  preview: hasDashboardAccess
    .input(
      z.object({
        calendar: deliveryCalendarSchema,
        year: z.number().int().min(2000).max(2100),
      }),
    )
    .query(({ ctx, input }) => {
      assertCan(ctx.user, "orders.send");
      validateDeliveryLocation(input.calendar);
      return {
        countries: deliveryCountries,
        ...deliveryLocations(input.calendar.country, input.calendar.state),
        holidays: deliveryHolidays(input.calendar, input.year),
        nextDate: scheduledDeliveryDate(input.calendar),
      };
    }),
  save: hasDashboardAccess
    .input(
      z.object({
        calendar: deliveryCalendarSchema,
        expectedUserId: z.string().min(1).max(255),
        expectedRevision: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCan(ctx.user, "orders.send");
      if (input.expectedUserId !== ctx.user.id)
        throw new TRPCError({
          code: "CONFLICT",
          message: "Your signed-in account changed. Reload before saving.",
        });
      return saveDeliveryCalendar(
        ctx.db,
        ctx.user.id,
        input.calendar,
        input.expectedRevision,
      );
    }),
});
