import { headers } from "next/headers";
import { NextResponse } from "next/server";
import Stripe from "stripe";
import { eq } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";
import { env } from "~/env";

function getStripeClient() {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-12-15.clover",
  });
}

export async function POST(req: Request) {
  const stripe = getStripeClient();
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET ?? "",
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error(`Webhook signature verification failed: ${errorMessage}`);
    return NextResponse.json(
      { error: `Webhook Error: ${errorMessage}` },
      { status: 400 },
    );
  }

  // Handle the event
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        console.log("checkout.session.completed");
        const session = event.data.object;
        const userId = session.metadata?.userId;

        if (!userId) {
          console.error("No userId in checkout session metadata");
          break;
        }

        // Handle one-time purchase
        if (session.metadata?.purchaseType === "one-time") {
          await db
            .update(users)
            .set({
              hasOneTimeAccess: true,
              oneTimePurchaseDate: new Date(),
            })
            .where(eq(users.id, userId));
        }
        // Handle subscription (subscription will be handled by customer.subscription.created)
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;

        // Find user by Stripe customer ID
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.stripeCustomerId, customerId))
          .limit(1);

        if (!user) {
          console.error(`User not found for customer ${customerId}`);
          break;
        }

        // Update subscription status
        const periodEnd = (
          subscription as unknown as { current_period_end?: number }
        ).current_period_end;
        await db
          .update(users)
          .set({
            stripeSubscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            subscriptionEndsAt: periodEnd ? new Date(periodEnd * 1000) : null,
          })
          .where(eq(users.id, user.id));
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        const customerId = subscription.customer as string;

        // Find user by Stripe customer ID
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.stripeCustomerId, customerId))
          .limit(1);

        if (!user) {
          console.error(`User not found for customer ${customerId}`);
          break;
        }

        // Clear subscription data
        await db
          .update(users)
          .set({
            stripeSubscriptionId: null,
            subscriptionStatus: "canceled",
            subscriptionEndsAt: null,
          })
          .where(eq(users.id, user.id));
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;

        // Find user by Stripe customer ID
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.stripeCustomerId, customerId))
          .limit(1);

        if (!user) {
          console.error(`User not found for customer ${customerId}`);
          break;
        }

        // Update subscription status to past_due
        await db
          .update(users)
          .set({
            subscriptionStatus: "past_due",
          })
          .where(eq(users.id, user.id));
        break;
      }

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
