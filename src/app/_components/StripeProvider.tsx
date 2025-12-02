"use client";

import { loadStripe } from "@stripe/stripe-js";
import { Elements } from "@stripe/react-stripe-js";
import { type ReactNode } from "react";
import { env } from "~/env";

// Initialize Stripe - you'll need to set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY in your .env
const stripePromise = loadStripe(
  env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
);

export function StripeProvider({
  children,
  clientSecret,
}: {
  children: ReactNode;
  clientSecret: string;
}) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret }}>
      {children}
    </Elements>
  );
}

