"use client";
import { createAccountPreference } from "~/hooks/create-account-preference";
import { useDrawingAccount } from "./DrawingAccountProvider";
import type { LengthUnit } from "~/lib/sheet-measure";
const usePreference = createAccountPreference<LengthUnit>({
  keyFor: (account) => `foremanhq:drawing-unit:${account}`,
  valid: (value): value is LengthUnit =>
    value === "ft" || value === "in" || value === "m" || value === "mm",
  initial: "ft",
});
export function useDrawingUnit() {
  const preference = usePreference(useDrawingAccount()?.accountKey);
  return preference;
}
