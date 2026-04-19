import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { ensureUser } from "~/server/utils/ensure-user";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof publishableKey === "string" &&
  /^(pk|test|live)_/.test(publishableKey) &&
  publishableKey.length > 20;

export default async function SignInLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!hasUsableClerkKey) {
    return <>{children}</>;
  }

  const { userId } = await auth();

  // If user is authenticated, redirect them away from sign-in page
  if (userId) {
    // Get user from database (webhook should have created it)
    const user = await ensureUser(userId);

    // If user exists and has organizationId, redirect to dashboard
    if (user?.organizationId) {
      redirect("/dashboard");
    }

    // If user exists but no organizationId, redirect to onboarding
    if (user && !user.organizationId) {
      redirect("/onboarding");
    }

    // If user doesn't exist in DB yet (webhook hasn't created them),
    // redirect to onboarding - the onboarding layout will wait for the webhook
    // This prevents showing sign-in page to authenticated users
    if (!user) {
      redirect("/onboarding");
    }
  }

  // User is not authenticated - show sign-in page
  return <>{children}</>;
}
