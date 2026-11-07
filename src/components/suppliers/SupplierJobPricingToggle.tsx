"use client";
import { SwitchTrack } from "~/components/ui/switch";
export function SupplierJobPricingToggle({
  checked = true,
  disabled,
  onChange,
}: {
  checked?: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 items-center gap-2 rounded-md px-2 text-sm disabled:opacity-50"
    >
      <SwitchTrack checked={checked} />
      Prefer Job Pricing
    </button>
  );
}
