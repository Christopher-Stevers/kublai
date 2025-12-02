"use client";

import { useState } from "react";
import {
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { CheckCircle2 } from "lucide-react";

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
      <Card>
        <CardContent className="p-8">
          <div className="flex flex-col items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">
              Payment method saved
            </h3>
            <p className="text-center text-sm text-gray-600">
              Your payment method has been successfully saved. You can now place
              orders without entering payment details again.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-8">
        <h2 className="mb-6 text-xl font-semibold text-gray-900">
          Add Payment Method
        </h2>
        <p className="mb-6 text-sm text-gray-600">
          Save your payment information to enable quick checkout for future orders.
          Your card details are securely stored by Stripe.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="rounded-lg border border-gray-200 p-4">
            <PaymentElement />
          </div>

          {error && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="p-3">
                <p className="text-sm text-red-600">{error}</p>
              </CardContent>
            </Card>
          )}

          <Button
            type="submit"
            disabled={!stripe || isProcessing}
            className="w-full"
          >
            {isProcessing ? "Processing..." : "Save Payment Method"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
