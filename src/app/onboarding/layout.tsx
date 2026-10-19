import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ORGANIZATION_INVITE_COOKIE } from "~/lib/organization-invite";
import { waitForUser } from "~/server/utils/wait-for-user";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, user: requestUser } = await getRequestIdentity(
    await headers(),
  );

  // Redirect if not authenticated
  if (!userId) {
    redirect("/sign-in");
  }

  // Get user from database (webhook should have created it)
  let user = requestUser;

  // If user doesn't exist, wait for webhook to create it (with timeout)
  // This ensures webhook is the single source of truth for user creation
  if (!user) {
    user = (await waitForUser(userId, 3000, 250)) as typeof user;
  }

  // If user still doesn't exist after waiting, show a waiting state instead of redirecting
  // This prevents redirect loops with the sign-in page and gives the webhook more time
  if (!user) {
    return (
      <div className="bg-muted/50 flex min-h-screen flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-foreground text-2xl font-bold">
            Setting up your account...
          </h1>
          <p className="text-muted-foreground">
            We're putting the finishing touches on your account setup. This
            usually takes just a few seconds.
          </p>
          <div className="flex justify-center py-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          </div>
          <p className="text-muted-foreground text-sm">
            The page will refresh automatically. If it doesn't, please{" "}
            <a href="/onboarding" className="text-primary hover:underline">
              click here to retry
            </a>
            .
          </p>
          <meta httpEquiv="refresh" content="5" />
        </div>
      </div>
    );
  }

  const inviteToken = (await cookies()).get(ORGANIZATION_INVITE_COOKIE)?.value;
  if (inviteToken) {
    redirect(`/join/${inviteToken}`);
  }

  // If user already has an organization, redirect to dashboard
  if (user.organizationId) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
