"use client";

import { api } from "~/trpc/react";
import { StripeProvider } from "./StripeProvider";
import { PaymentSetup } from "./PaymentSetup";
import { useUser } from "@clerk/nextjs";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof publishableKey === "string" &&
  /^(pk|test|live)_/.test(publishableKey) &&
  publishableKey.length > 20;

function PaymentSetupWithClerk() {
  const { user } = useUser();
  const { data: setupIntentData, isLoading, error } =
    api.payment.createSetupIntent.useQuery(undefined, {
      enabled: true,
    });

  if (isLoading) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-gray-600">Loading payment form...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
          {error.message ??
            "Failed to initialize payment form. Please refresh the page."}
        </div>
      </div>
    );
  }

  if (!setupIntentData?.clientSecret) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-red-600">
          Failed to initialize payment form. Please refresh the page.
        </div>
      </div>
    );
  }

  return (
    <StripeProvider clientSecret={setupIntentData.clientSecret}>
      <PaymentSetup
        clientSecret={setupIntentData.clientSecret}
        userEmail={user?.primaryEmailAddress?.emailAddress ?? ""}
      />
    </StripeProvider>
  );
}

function PaymentSetupWithoutClerk() {
  return (
    <div className="rounded-lg bg-white p-8 shadow-sm">
      <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
        Payment setup is disabled until Clerk and Stripe are configured.
      </div>
    </div>
  );
}

export function PaymentSetupWrapper() {
  return hasUsableClerkKey ? (
    <PaymentSetupWithClerk />
  ) : (
    <PaymentSetupWithoutClerk />
  );
}
