import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { users } from "~/server/db/schema";

// Initialize Stripe with secret key
const stripe = new Stripe(env.STRIPE_SECRET_KEY as string, {
  apiVersion: "2025-11-17.clover",
});

export const paymentRouter = createTRPCRouter({
  createSetupIntent: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    if (!userId) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User ID not found in session",
      });
    }

    // 1. Fetch user from database
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found in database",
      });
    }

    // 2. Ensure Stripe customer exists
    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      try {
        const customer = await stripe.customers.create({
          metadata: { userId: user.id },
          email: user.email ?? undefined,
          name: user.name ?? undefined,
        });

        stripeCustomerId = customer.id;

        // Update user with Stripe customer ID
        await ctx.db
          .update(users)
          .set({ stripeCustomerId })
          .where(eq(users.id, user.id));
      } catch (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create Stripe customer",
          cause: error,
        });
      }
    }

    // 3. Create SetupIntent
    try {
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
        usage: "off_session",
      });

      if (!setupIntent.client_secret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "SetupIntent created but client_secret is missing",
        });
      }

      return {
        customerId: stripeCustomerId,
        clientSecret: setupIntent.client_secret,
        userEmail: user.email ?? "",
      };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create SetupIntent",
        cause: error,
      });
    }
  }),
});

