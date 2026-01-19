"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { type ReactNode } from "react";

export function SessionProviderWrapper({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      // Redirect to onboarding after sign-in - the onboarding layout will check
      // if user has organizationId and redirect to dashboard if they do
      afterSignInUrl="/onboarding"
      afterSignUpUrl="/onboarding"
    >
      {children}
    </ClerkProvider>
  );
}
