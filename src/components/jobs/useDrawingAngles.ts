"use client";
import { createAccountPreference } from "~/hooks/create-account-preference";
import { useDrawingAccount } from "./DrawingAccountProvider";
type AngleSetting = "on" | "off";
const usePreference = createAccountPreference<AngleSetting>({
  keyFor: (account) => `foremanhq:drawing-angles:${account}`,
  valid: (value): value is AngleSetting => value === "on" || value === "off",
  initial: "off",
});
export function useDrawingAngles() {
  const preference = usePreference(useDrawingAccount()?.accountKey);
  return preference;
}
