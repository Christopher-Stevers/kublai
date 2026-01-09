"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { MarketingHeader } from "../_components/MarketingHeader";
import { Loader2 } from "lucide-react";

export default function PricingPage() {
  const router = useRouter();
  const [isCreatingCheckout, setIsCreatingCheckout] = useState<string | null>(null);

  const createOneTimeCheckout = api.payment.createOneTimeCheckout.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error) => {
      console.error("Failed to create checkout:", error);
      setIsCreatingCheckout(null);
    },
  });

  const createSubscriptionCheckout = api.payment.createSubscriptionCheckout.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: (error) => {
      console.error("Failed to create checkout:", error);
      setIsCreatingCheckout(null);
    },
  });

  const handleOneTimePurchase = () => {
    setIsCreatingCheckout("one-time");
    createOneTimeCheckout.mutate();
  };

  const handleSubscription = () => {
    setIsCreatingCheckout("subscription");
    createSubscriptionCheckout.mutate();
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <MarketingHeader />
      <main className="flex-1 px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-16 text-center">
            <h1 className="mb-4 text-5xl font-bold text-gray-900">
              Choose Your Plan
            </h1>
            <p className="text-xl text-gray-600">
              Get access to the dashboard with a one-time purchase or subscription
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-2">
            {/* One-Time Purchase */}
            <Card className="relative">
              <CardHeader>
                <CardTitle className="text-2xl">One-Time Purchase</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">
                    $99
                  </span>
                  <span className="text-gray-600"> one-time</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="mb-6 space-y-3 text-sm text-gray-600">
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-green-500"
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
                    Lifetime dashboard access
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-green-500"
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
                    No recurring charges
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-green-500"
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
                    All features included
                  </li>
                </ul>
                <Button
                  className="w-full"
                  onClick={handleOneTimePurchase}
                  disabled={isCreatingCheckout !== null}
                >
                  {isCreatingCheckout === "one-time" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Purchase Now"
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Subscription */}
            <Card className="relative border-2 border-primary">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-primary px-4 py-1 text-sm font-semibold text-white">
                  Popular
                </span>
              </div>
              <CardHeader>
                <CardTitle className="text-2xl">Monthly Subscription</CardTitle>
                <div className="mt-4">
                  <span className="text-4xl font-bold text-gray-900">
                    $29
                  </span>
                  <span className="text-gray-600"> /month</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="mb-6 space-y-3 text-sm text-gray-600">
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-green-500"
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
                    Full dashboard access
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-green-500"
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
                    Cancel anytime
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-green-500"
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
                    All features included
                  </li>
                  <li className="flex items-center">
                    <svg
                      className="mr-2 h-5 w-5 text-green-500"
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
                    Regular updates
                  </li>
                </ul>
                <Button
                  className="w-full"
                  onClick={handleSubscription}
                  disabled={isCreatingCheckout !== null}
                >
                  {isCreatingCheckout === "subscription" ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    "Subscribe Now"
                  )}
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="mt-12 text-center">
            <p className="text-gray-600">
              Already have access?{" "}
              <Link href="/dashboard" className="text-primary hover:underline">
                Go to Dashboard
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

