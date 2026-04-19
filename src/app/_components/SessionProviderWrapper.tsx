"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { Fragment, type ReactNode } from "react";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof publishableKey === "string" &&
  /^(pk|test|live)_/.test(publishableKey) &&
  publishableKey.length > 20;

export function SessionProviderWrapper({ children }: { children: ReactNode }) {
  if (!hasUsableClerkKey) {
    return <Fragment>{children}</Fragment>;
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      // Redirect to onboarding after sign-in, the onboarding layout will check
      // if user has organizationId and redirect to dashboard if they do.
      afterSignInUrl="/onboarding"
      afterSignUpUrl="/onboarding"
    >
      {children}
    </ClerkProvider>
  );
}
