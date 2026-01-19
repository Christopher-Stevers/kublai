"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Loader2 } from "lucide-react";

export default function OnboardingPage() {
  const router = useRouter();
  const utils = api.useUtils();
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createOrganization = api.organization.createOrganization.useMutation({
    onSuccess: async () => {
      // Invalidate user queries to refresh organizationId
      await utils.user.getMyRole.invalidate();
      console.log("Created organization, redirecting to dashboard");

      // Use replace instead of push to avoid adding to history
      // This ensures back button doesn't take user back to onboarding
      router.push("/dashboard");
    },
    onError: (error) => {
      setError(error.message ?? "Failed to create organization");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!orgName.trim()) {
      setError("Organization name is required");
      return;
    }

    // Prevent double submission
    if (createOrganization.isPending) {
      return;
    }

    createOrganization.mutate({ name: orgName.trim() });
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome! Let's get started</CardTitle>
          <p className="mt-2 text-sm text-gray-600">
            Create your organization to begin using Kublai. This will set up
            your workspace with a default pricing profile.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="orgName"
                className="mb-2 block text-sm font-medium text-gray-700"
              >
                Organization Name
              </label>
              <Input
                id="orgName"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="Enter your organization name"
                disabled={createOrganization.isPending}
                className="w-full"
                required
                minLength={1}
                maxLength={255}
                autoFocus
                onKeyDown={(e) => {
                  // Allow Enter key to submit form (default behavior)
                  // But prevent if already submitting
                  if (e.key === "Enter" && createOrganization.isPending) {
                    e.preventDefault();
                  }
                }}
              />
            </div>

            {error && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={createOrganization.isPending || !orgName.trim()}
              className="w-full"
            >
              {createOrganization.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Organization"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
