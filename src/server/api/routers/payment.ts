import { TRPCError } from "@trpc/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";

import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { env } from "~/env";
import { users } from "~/server/db/schema";

function getStripeClient() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "STRIPE_SECRET_KEY is not configured",
    });
  }

  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-12-15.clover",
  });
}

export const paymentRouter = createTRPCRouter({
  /**
   * Create a Stripe Setup Intent for saving payment methods
   */
  createSetupIntent: protectedProcedure.query(async ({ ctx }) => {
    const stripe = getStripeClient();
    const user = ctx.user;

    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    // Ensure Stripe customer exists
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
        console.error(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create Stripe customer",
          cause: error,
        });
      }
    }

    try {
      // Create Setup Intent for saving payment methods
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ["card"],
      });

      if (!setupIntent.client_secret) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create setup intent",
        });
      }

      return { clientSecret: setupIntent.client_secret };
    } catch (error) {
      console.error(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create setup intent",
        cause: error,
      });
    }
  }),

  /**
   * Create a Stripe Checkout Session for one-time purchase
   */
  createOneTimeCheckout: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripeClient();
    const userId = ctx.userId;
    const user = ctx.user;

    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    // Ensure Stripe customer exists
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
        console.error(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create Stripe customer",
          cause: error,
        });
      }
    }

    try {
      // Create Checkout Session for one-time purchase
      // Note: You'll need to set STRIPE_ONE_TIME_PRICE_ID in your environment variables
      const oneTimePriceId = process.env.STRIPE_ONE_TIME_PRICE_ID;
      if (!oneTimePriceId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "STRIPE_ONE_TIME_PRICE_ID is not configured",
        });
      }

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "payment",
        line_items: [
          {
            price: oneTimePriceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/dashboard?payment=success`,
        cancel_url: `${baseUrl}/pricing?canceled=true`,
        metadata: {
          userId: user.id,
          purchaseType: "one-time",
        },
      });

      if (!session.url) {
        console.log("No session URL returned");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create checkout session",
        });
      }

      return { url: session.url };
    } catch (error) {
      console.error(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create checkout session",
        cause: error,
      });
    }
  }),

  /**
   * Create a Stripe Checkout Session for subscription
   */
  createSubscriptionCheckout: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripeClient();
    const userId = ctx.userId;
    const user = ctx.user;

    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    // Ensure Stripe customer exists
    let stripeCustomerId = user.stripeCustomerId;

    if (!stripeCustomerId) {
      try {
        const customer = await stripe.customers.create({
          metadata: { userId: user.id },
          email: user.email ?? undefined,
          name: user.name ?? undefined,
        });

        stripeCustomerId = customer.id!;

        // Update user with Stripe customer ID
        await ctx.db
          .update(users)
          .set({ stripeCustomerId })
          .where(eq(users.id, user.id));
      } catch (error) {
        console.error(error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create Stripe customer",
          cause: error,
        });
      }
    }

    try {
      // Create Checkout Session for subscription
      // Note: You'll need to set STRIPE_SUBSCRIPTION_PRICE_ID in your environment variables
      const subscriptionPriceId = process.env.STRIPE_SUBSCRIPTION_PRICE_ID;
      if (!subscriptionPriceId) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "STRIPE_SUBSCRIPTION_PRICE_ID is not configured",
        });
      }

      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const session = await stripe.checkout.sessions.create({
        customer: stripeCustomerId,
        mode: "subscription",
        line_items: [
          {
            price: subscriptionPriceId,
            quantity: 1,
          },
        ],
        success_url: `${baseUrl}/dashboard?payment=success`,
        cancel_url: `${baseUrl}/pricing?canceled=true`,
        metadata: {
          userId: user.id,
          purchaseType: "subscription",
        },
      });

      if (!session.url) {
        console.log("No session URL returned");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create checkout session",
        });
      }

      return { url: session.url };
    } catch (error) {
      console.error(error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create checkout session",
        cause: error,
      });
    }
  }),

  /**
   * Get current subscription/payment status
   */
  getSubscriptionStatus: protectedProcedure.query(async ({ ctx }) => {
    const user = ctx.user;

    if (!user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    // Check if user has active subscription
    const hasActiveSubscription =
      user.stripeSubscriptionId &&
      user.subscriptionStatus === "active" &&
      (!user.subscriptionEndsAt ||
        new Date(user.subscriptionEndsAt) > new Date());

    // Check if user has one-time access
    const hasOneTimeAccess = user.hasOneTimeAccess === true;

    return {
      hasAccess: hasActiveSubscription || hasOneTimeAccess,
      hasActiveSubscription: hasActiveSubscription ?? false,
      hasOneTimeAccess: hasOneTimeAccess,
      subscriptionStatus: user.subscriptionStatus,
      subscriptionEndsAt: user.subscriptionEndsAt,
      oneTimePurchaseDate: user.oneTimePurchaseDate,
    };
  }),

  /**
   * Create Stripe Customer Portal session for managing subscription
   */
  createPortalSession: protectedProcedure.mutation(async ({ ctx }) => {
    const stripe = getStripeClient();
    const user = ctx.user;

    if (!user?.stripeCustomerId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "No Stripe customer found",
      });
    }

    try {
      const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/dashboard/account`,
      });

      return { url: session.url };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to create portal session",
        cause: error,
      });
    }
  }),
});
