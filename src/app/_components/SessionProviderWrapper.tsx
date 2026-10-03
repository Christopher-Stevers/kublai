"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { Fragment, type ReactNode } from "react";

const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
const hasUsableClerkKey =
  typeof publishableKey === "string" &&
  /^(pk|test|live)_/.test(publishableKey) &&
  publishableKey.length > 20;
// Sign-in and sign-up share one placeholder key, so override it on sign-up only.
const SIGN_UP_LOCALIZATION = {
  formFieldInputPlaceholder__password: "New password",
};

export function SessionProviderWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (!hasUsableClerkKey) {
    return <Fragment>{children}</Fragment>;
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      localization={
        pathname?.startsWith("/sign-up") ? SIGN_UP_LOCALIZATION : undefined
      }
      // Redirect to onboarding after sign-in, the onboarding layout will check
      // if user has organizationId and redirect to dashboard if they do.
      afterSignInUrl="/onboarding"
      afterSignUpUrl="/onboarding"
    >
      {children}
    </ClerkProvider>
  );
}
