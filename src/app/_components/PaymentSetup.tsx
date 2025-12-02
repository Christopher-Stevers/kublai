"use client";

import { useState } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

interface PaymentSetupProps {
  clientSecret: string;
  userEmail: string;
}

export function PaymentSetup({ clientSecret, userEmail }: PaymentSetupProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      setError("Stripe is not ready. Please wait a moment and try again.");
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      // Submit the form to validate payment details
      const { error: submitError } = await elements.submit();

      if (submitError) {
        setError(submitError.message ?? "Please check your payment details");
        setIsProcessing(false);
        return;
      }

      // Confirm the setup after successful validation
      const { error: confirmError } = await stripe.confirmSetup({
        elements,
        clientSecret,
        redirect: "if_required",
        confirmParams: {
          payment_method_data: {
            billing_details: {
              email: userEmail,
            },
          },
        },
      });

      if (confirmError) {
        setError(confirmError.message ?? "Failed to save payment method");
        setIsProcessing(false);
      } else {
        setSuccess(true);
        setIsProcessing(false);
      }
    } catch {
      setError("An unexpected error occurred");
      setIsProcessing(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
            <svg
              className="h-6 w-6 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900">
            Payment method saved
          </h3>
          <p className="text-center text-sm text-gray-600">
            Your payment method has been successfully saved. You can now place
            orders without entering payment details again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-white p-8 shadow-sm">
      <h2 className="mb-6 text-xl font-semibold text-gray-900">
        Add Payment Method
      </h2>
      <p className="mb-6 text-sm text-gray-600">
        Save your payment information to enable quick checkout for future orders.
        Your card details are securely stored by Stripe.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-lg border border-gray-200 p-4">
          <PaymentElement  />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!stripe || isProcessing}
          className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isProcessing ? "Processing..." : "Save Payment Method"}
        </button>
      </form>
    </div>
  );
}

