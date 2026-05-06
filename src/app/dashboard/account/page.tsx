"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Input } from "~/components/ui/input";
import { Loader2, ExternalLink, WifiOffIcon, DownloadIcon, CheckCircle2Icon } from "lucide-react";
import { useOnlineStatus } from "~/hooks/use-online-status";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneApp() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}

export default function AccountPage() {
  const [isCreatingPortal, setIsCreatingPortal] = useState(false);
  const [name, setName] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const isOnline = useOnlineStatus();
  const utils = api.useUtils();

  const { data: me } = api.user.getMe.useQuery(undefined, {
    enabled: isOnline,
  });

  useEffect(() => {
    if (me?.name) setName(me.name);
  }, [me?.name]);

  useEffect(() => {
    setIsInstalled(isStandaloneApp());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const { data: status, isLoading } = api.payment.getSubscriptionStatus.useQuery(undefined, {
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

  const handleInstallApp = async () => {
    if (!installPrompt || isInstalled) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    setInstallPrompt(null);
    if (choice.outcome === "accepted") {
      setIsInstalled(true);
    }
  };

  if (isLoading && isOnline) {
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
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isOnline && (
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
                  <WifiOffIcon className="h-3 w-3" /> Profile changes require internet
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="account-name" className="text-sm font-medium text-gray-900">
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
                disabled={!isOnline || !name.trim() || updateProfile.isPending || name.trim() === (me?.name ?? "")}
              >
                {updateProfile.isPending ? "Saving..." : "Save Name"}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>App</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900">Install ForemenHQ</p>
                <p className="text-muted-foreground text-sm">
                  Add the app to your device for a faster, full-screen experience.
                </p>
              </div>

              {isInstalled ? (
                <div className="inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-900">
                  <CheckCircle2Icon className="h-3 w-3" /> App installed
                </div>
              ) : installPrompt ? (
                <Button onClick={handleInstallApp} className="w-full sm:w-auto">
                  <DownloadIcon className="mr-2 h-4 w-4" /> Install App
                </Button>
              ) : (
                <div className="space-y-2">
                  <Button disabled variant="outline" className="w-full sm:w-auto">
                    <DownloadIcon className="mr-2 h-4 w-4" /> Install App
                  </Button>
                  <p className="text-muted-foreground text-xs">
                    If your browser supports installation, use its menu and choose “Install app” or “Add to Home Screen.”
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Status */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isOnline && (
                <div className="inline-flex items-center gap-2 rounded-full bg-orange-100 px-3 py-1 text-xs font-medium text-orange-900">
                  <WifiOffIcon className="h-3 w-3" /> Account billing requires internet
                </div>
              )}
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

              {isOnline && !status?.hasAccess && (
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
