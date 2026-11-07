import { formatSizeDimensions } from "./size-utils";
import { wizardExactSizeLabel } from "./wizard-size-selection";

export type WizardSizeOptionValue = {
  nominal: number;
  unit: string;
  sizeLabel?: string | null;
};

/** Stored size aliases share one choice; single diameters select the whole family. */
export function wizardSizeOptions(values: WizardSizeOptionValue[]) {
  const options = new Map<
    string,
    { label: string; size: WizardSizeOptionValue }
  >();
  for (const value of values) {
    const exactLabel = wizardExactSizeLabel(value.sizeLabel);
    const label = formatSizeDimensions(exactLabel ?? value.nominal, value.unit);
    // Compound labels remain exact catalogue filters; retain their stored identity.
    const key = `${value.unit}:${exactLabel ?? label}`;
    if (!options.has(key)) {
      options.set(key, {
        label,
        size: { ...value, sizeLabel: exactLabel ?? null },
      });
    }
  }
  return [...options.values()];
}
