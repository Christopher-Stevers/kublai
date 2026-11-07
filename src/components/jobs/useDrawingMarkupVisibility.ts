"use client";
import { createAccountPreference } from "~/hooks/create-account-preference";
import { useDrawingAccount } from "./DrawingAccountProvider";
type MarkupVisibility = "private" | "published";
const usePreference = createAccountPreference<MarkupVisibility>({
  keyFor: (account) => `foremanhq:drawing-markup-visibility:${account}`,
  valid: (value): value is MarkupVisibility =>
    value === "private" || value === "published",
  initial: "published",
});
export function useDrawingMarkupVisibility() {
  const preference = usePreference(useDrawingAccount()?.accountKey);
  return [preference[0], preference[1]] as const;
}
