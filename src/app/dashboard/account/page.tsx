"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Loader2, ExternalLink } from "lucide-react";

export default function AccountPage() {
  const [isCreatingPortal, setIsCreatingPortal] = useState(false);

  const { data: status, isLoading } = api.payment.getSubscriptionStatus.useQuery();
  const createPortalSession = api.payment.createPortalSession.useMutation({
    onSuccess: (data) => {
      if (data.url) {
        window.location.href = data.url;
      }
    },
    onError: () => {
      setIsCreatingPortal(false);
    },
  });

  const handleManageSubscription = () => {
    setIsCreatingPortal(true);
    createPortalSession.mutate();
  };

  if (isLoading) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="mb-6 text-2xl font-bold text-gray-900 sm:mb-8 sm:text-3xl">
            Account
          </h1>
          <Card>
            <CardContent className="p-6 sm:p-8">
              <p className="text-center text-gray-600">Loading...</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-2xl font-bold text-gray-900 sm:mb-8 sm:text-3xl">
          Account
        </h1>
        <div className="space-y-6 sm:space-y-8">
          {/* Payment Status */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {status?.hasAccess ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                    Active
                  </Badge>
                  <span className="text-sm text-gray-600">You have dashboard access</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                    No Access
                  </Badge>
                  <span className="text-sm text-gray-600">Please purchase access to continue</span>
                </div>
              )}

              {status?.hasActiveSubscription && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">Subscription Status:</span>
                    <Badge variant="outline">
                      {status.subscriptionStatus ?? "Unknown"}
                    </Badge>
                  </div>
                  {status.subscriptionEndsAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-900">Renews:</span>
                      <span className="text-sm text-gray-600">
                        {new Date(status.subscriptionEndsAt).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleManageSubscription}
                    disabled={isCreatingPortal}
                    variant="outline"
                    className="w-full"
                  >
                    {isCreatingPortal ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        Manage Subscription
                        <ExternalLink className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              )}

              {status?.hasOneTimeAccess && status.oneTimePurchaseDate && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">Purchase Type:</span>
                    <Badge variant="outline">One-Time Purchase</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900">Purchased:</span>
                    <span className="text-sm text-gray-600">
                      {new Date(status.oneTimePurchaseDate).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              )}

              {!status?.hasAccess && (
                <Button asChild className="w-full">
                  <a href="/pricing">Get Access</a>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
