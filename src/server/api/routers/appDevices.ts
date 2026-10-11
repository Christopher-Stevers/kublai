import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, hasDashboardAccess } from "~/server/api/trpc";
import { assertCan } from "~/server/auth/permissions";
import { APP_DEVICE_TYPES } from "~/lib/app-devices";
import {
  recordAppDevice,
  organizationAppDevices,
} from "~/server/app-devices/service";

export const appDevicesRouter = createTRPCRouter({
  report: hasDashboardAccess
    .input(
      z
        .object({
          deviceId: z.string().uuid(),
          deviceType: z.enum(APP_DEVICE_TYPES),
          platform: z.enum([
            "Android",
            "iPhone",
            "iPad",
            "Windows",
            "Mac",
            "Linux",
            "Other",
          ]),
          mode: z.enum(["browser", "installed-app"]),
          installButtonVisible: z.boolean(),
        })
        .strict(),
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.simulation) return { recorded: false };
      await recordAppDevice(ctx.db, ctx.userId, input);
      return { recorded: true };
    }),
  organization: hasDashboardAccess
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      assertCan(ctx.user, "tab.organization");
      assertCan(ctx.user, "org.members");
      if (input.organizationId !== ctx.user.organizationId)
        throw new TRPCError({ code: "FORBIDDEN" });
      return organizationAppDevices(ctx.db, ctx.user.organizationId);
    }),
});
