"use client";

import { api } from "~/trpc/react";
import { StripeProvider } from "./StripeProvider";
import { PaymentSetup } from "./PaymentSetup";
import { useSession } from "next-auth/react";

export function PaymentSetupWrapper() {
  const { data: session } = useSession();
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
          {error.message ?? "Failed to initialize payment form. Please refresh the page."}
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
        userEmail={session?.user?.email ?? ""}
      />
    </StripeProvider>
  );
}

