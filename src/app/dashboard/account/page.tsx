"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Loader2, ExternalLink, WifiOffIcon } from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { FormSkeleton } from "~/components/ui/skeleton";
import { PasswordSettings } from "~/components/account/PasswordSettings";

export default function AccountPage() {
  const [isCreatingPortal, setIsCreatingPortal] = useState(false);
  const [name, setName] = useState("");
  const isOnline = useOnlineStatus();
  const utils = api.useUtils();

  const { data: me } = api.user.getMe.useQuery(undefined, {
    enabled: isOnline,
  });

  useEffect(() => {
    if (me?.name) setName(me.name);
  }, [me?.name]);

  const { data: status, isLoading } =
    api.payment.getSubscriptionStatus.useQuery(undefined, {
      enabled: isOnline,
    });
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
  const updateProfile = api.user.updateProfile.useMutation({
    onSuccess: async () => {
      await utils.user.getMe.invalidate();
    },
  });

  const handleManageSubscription = () => {
    if (!isOnline) return;
    setIsCreatingPortal(true);
    createPortalSession.mutate();
  };

  const handleSaveProfile = () => {
    if (!isOnline || !name.trim()) return;
    updateProfile.mutate({ name: name.trim() });
  };

  if (isLoading && isOnline) {
    return (
      <div className="px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-4xl">
          <PageHeader
            title="Account"
            description="Your profile, sign-in and subscription"
          />
          <Card>
            <CardContent className="p-6 sm:p-8">
              <FormSkeleton label="Loading account" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          title="Account"
          description="Your profile, sign-in and subscription"
        />
        <div className="space-y-6 sm:space-y-8">
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isOnline && (
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
                  <WifiOffIcon className="h-3 w-3" /> Profile changes require
                  internet
                </div>
              )}
              <div className="space-y-1">
                <label
                  htmlFor="account-name"
                  className="text-foreground text-sm font-medium"
                >
                  Name
                </label>
                <Input
                  id="account-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  disabled={!isOnline || updateProfile.isPending}
                />
                <p className="text-muted-foreground text-xs">
                  This name is used to sign generated order emails.
                </p>
              </div>
              <Button
                onClick={handleSaveProfile}
                disabled={
                  !isOnline ||
                  !name.trim() ||
                  updateProfile.isPending ||
                  name.trim() === (me?.name ?? "")
                }
              >
                {updateProfile.isPending ? "Saving..." : "Save Name"}
              </Button>
            </CardContent>
          </Card>

          <PasswordSettings isOnline={isOnline} />

          <Card>
            <CardHeader>
              <CardTitle>Account Type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isOnline && (
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
                  <WifiOffIcon className="h-3 w-3" /> Account billing requires
                  internet
                </div>
              )}
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={
                    status?.hasManagingAccount
                      ? "border-green-200 bg-green-50 text-green-700"
                      : "border-border bg-muted/50 text-foreground/80"
                  }
                >
                  {status?.accountTypeLabel ?? "Standard Account"}
                </Badge>
                <span className="text-muted-foreground text-sm">
                  {status?.hasManagingAccount
                    ? "You can manage lists, generate quotes, and generate orders."
                    : "You can use the dashboard with standard account permissions."}
                </span>
              </div>

              {status?.hasActiveSubscription && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-foreground text-sm font-medium">
                      Subscription Status:
                    </span>
                    <Badge variant="outline">
                      {status.subscriptionStatus ?? "Unknown"}
                    </Badge>
                  </div>
                  {status.subscriptionEndsAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-foreground text-sm font-medium">
                        Renews:
                      </span>
                      <span className="text-muted-foreground text-sm">
                        {new Date(
                          status.subscriptionEndsAt,
                        ).toLocaleDateString()}
                      </span>
                    </div>
                  )}
                  <Button
                    onClick={handleManageSubscription}
                    disabled={!isOnline || isCreatingPortal}
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
                    <span className="text-foreground text-sm font-medium">
                      Purchase Type:
                    </span>
                    <Badge variant="outline">One-Time Purchase</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-foreground text-sm font-medium">
                      Purchased:
                    </span>
                    <span className="text-muted-foreground text-sm">
                      {new Date(
                        status.oneTimePurchaseDate,
                      ).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              )}

              {isOnline && !status?.hasManagingAccount && (
                <Button asChild className="w-full">
                  <a href="/pricing">Upgrade to Executive Account</a>
                </Button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
