import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { hasDashboardAccess } from "./trpc";

/** Never acknowledge or permanently reject edits queued by an older client. */
export const retiredOfflineMutation = hasDashboardAccess
  .input(z.unknown())
  .mutation(() => {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message:
        "This app version needs an update. Reload ForemanHQ. Your unsent offline edits have not been accepted or deleted.",
    });
  });
