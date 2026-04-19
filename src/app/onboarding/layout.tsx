import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ensureUser } from "~/server/utils/ensure-user";
import { waitForUser } from "~/server/utils/wait-for-user";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId } = await auth();

  // Redirect if not authenticated
  if (!userId) {
    redirect("/sign-in");
  }

  // Get user from database (webhook should have created it)
  let user = await ensureUser(userId);

  // If user doesn't exist, wait for webhook to create it (with timeout)
  // This ensures webhook is the single source of truth for user creation
  if (!user) {
    user = await waitForUser(userId, 3000, 250);
  }

  // If user still doesn't exist after waiting, show a waiting state instead of redirecting
  // This prevents redirect loops with the sign-in page and gives the webhook more time
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 p-6 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-2xl font-bold text-gray-900">
            Setting up your account...
          </h1>
          <p className="text-gray-600">
            We're putting the finishing touches on your account setup. This
            usually takes just a few seconds.
          </p>
          <div className="flex justify-center py-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-600 border-t-transparent"></div>
          </div>
          <p className="text-sm text-gray-500">
            The page will refresh automatically. If it doesn't, please{" "}
            <a href="/onboarding" className="text-blue-600 hover:underline">
              click here to retry
            </a>
            .
          </p>
          <meta httpEquiv="refresh" content="5" />
        </div>
      </div>
    );
  }

  // If user already has an organization, redirect to dashboard
  if (user.organizationId) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}


