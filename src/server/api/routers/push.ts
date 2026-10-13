import { createHash, ECDH, randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createTRPCRouter,
  hasDashboardAccess,
  protectedProcedure,
  publicProcedure,
} from "~/server/api/trpc";
import { assertCanAccessTab, userCan } from "~/server/auth/permissions";
import { chatPushSubscriptions } from "~/server/db/chat-push-schema";
import { getPushConfiguration } from "~/server/chat/push";
import { isAllowedPushEndpoint } from "~/server/chat/push-policy";
import { PUSH_DEVICE_TYPES } from "~/lib/member-notifications";

function validKey(value: string, length: number) {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== length) return false;
  if (length === 65) {
    try {
      ECDH.convertKey(bytes, "prime256v1");
    } catch {
      return false;
    }
  }
  return true;
}
const endpoint = z
  .string()
  .max(4096)
  .refine(
    isAllowedPushEndpoint,
    "This browser's push provider is not supported.",
  );
const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

export const pushRouter = createTRPCRouter({
  identity: publicProcedure.query(({ ctx }) => {
    const pushUser = ctx.actorUser ?? ctx.user;
    const eligible =
      pushUser?.organizationId &&
      pushUser.organizationAccessStatus === "approved" &&
      userCan(pushUser, "tab.dashboard");
    return {
      userId: pushUser?.id ?? null,
      account: pushUser?.id ? tokenHash(pushUser.id) : null,
      simulation: Boolean(ctx.simulation),
      eligible: Boolean(eligible),
      publicKey: eligible ? (getPushConfiguration()?.publicKey ?? null) : null,
    };
  }),
  device: protectedProcedure
    .input(z.object({ endpoint }))
    .query(async ({ ctx, input }) => {
      const [subscription] = await ctx.db
        .select({ id: chatPushSubscriptions.id })
        .from(chatPushSubscriptions)
        .where(
          and(
            eq(chatPushSubscriptions.endpoint, input.endpoint),
            eq(chatPushSubscriptions.userId, ctx.actorUser?.id ?? ctx.userId),
          ),
        )
        .limit(1);
      return { subscribed: Boolean(subscription) };
    }),
  subscribe: hasDashboardAccess
    .input(
      z.object({
        endpoint,
        deviceType: z.enum(PUSH_DEVICE_TYPES).default("unknown"),
        keys: z.object({
          p256dh: z
            .string()
            .max(100)
            .refine(
              (value) => validKey(value, 65),
              "Invalid browser encryption key",
            ),
          auth: z
            .string()
            .max(30)
            .refine(
              (value) => validKey(value, 16),
              "Invalid browser authentication key",
            ),
        }),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanAccessTab(ctx.user, "dashboard");
      if (ctx.user.organizationAccessStatus !== "approved")
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Approved organization access is required.",
        });
      if (!getPushConfiguration())
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Push notifications have not been configured on the server yet.",
        });
      const revokeToken = randomBytes(32).toString("base64url");
      await ctx.db.transaction(async (tx) => {
        // Bound a single account's stored devices, including concurrent subscribe requests.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`chat-push-user:${ctx.userId}`},0))`,
        );
        const devices = await tx
          .select({ endpoint: chatPushSubscriptions.endpoint })
          .from(chatPushSubscriptions)
          .where(eq(chatPushSubscriptions.userId, ctx.userId));
        if (
          devices.length >= 20 &&
          !devices.some((item) => item.endpoint === input.endpoint)
        ) {
          throw new TRPCError({
            code: "TOO_MANY_REQUESTS",
            message:
              "This account has 20 notification devices. Disable one before adding another.",
          });
        }
        await tx
          .insert(chatPushSubscriptions)
          .values({
            userId: ctx.userId,
            endpoint: input.endpoint,
            p256dh: input.keys.p256dh,
            auth: input.keys.auth,
            revokeTokenHash: tokenHash(revokeToken),
            deviceType: input.deviceType,
          })
          .onConflictDoUpdate({
            target: chatPushSubscriptions.endpoint,
            set: {
              userId: ctx.userId,
              p256dh: input.keys.p256dh,
              auth: input.keys.auth,
              revokeTokenHash: tokenHash(revokeToken),
              deviceType: input.deviceType,
              updatedAt: new Date(),
            },
          });
      });
      return {
        revokeToken,
        account: tokenHash(ctx.userId),
        userId: ctx.userId,
      };
    }),
  // Update only an existing opt-in owned by this account. No new subscription
  // or account reassignment can be performed through device reporting.
  reportDevice: hasDashboardAccess
    .input(
      z.object({
        endpoint,
        revokeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
        deviceType: z.enum(PUSH_DEVICE_TYPES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertCanAccessTab(ctx.user, "dashboard");
      const rows = await ctx.db
        .update(chatPushSubscriptions)
        .set({ deviceType: input.deviceType })
        .where(
          and(
            eq(chatPushSubscriptions.endpoint, input.endpoint),
            eq(chatPushSubscriptions.userId, ctx.userId),
            eq(
              chatPushSubscriptions.revokeTokenHash,
              tokenHash(input.revokeToken),
            ),
          ),
        )
        .returning({ id: chatPushSubscriptions.id });
      return { updated: rows.length > 0 };
    }),
  unsubscribe: protectedProcedure
    .input(z.object({ endpoint }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(chatPushSubscriptions)
        .where(
          and(
            eq(chatPushSubscriptions.endpoint, input.endpoint),
            eq(chatPushSubscriptions.userId, ctx.userId),
          ),
        );
      return { ok: true as const };
    }),
  // Capability limited to deleting one device, usable after sign-out or an account switch.
  revokeDevice: publicProcedure
    .input(
      z.object({
        endpoint,
        revokeToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(chatPushSubscriptions)
        .where(
          and(
            eq(chatPushSubscriptions.endpoint, input.endpoint),
            eq(
              chatPushSubscriptions.revokeTokenHash,
              tokenHash(input.revokeToken),
            ),
          ),
        );
      return { ok: true as const };
    }),
});
