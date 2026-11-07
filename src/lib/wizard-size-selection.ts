/** A single diameter selects its whole family; only a compound size is exact. */
export function wizardExactSizeLabel(label?: string | null): string | undefined {
  return label && /\d\s*["″”]?\s*[x×]\s*\d/i.test(label) ? label : undefined;
}

export function sortWizardSizeFamily<T extends { sizeLabel?: string | null }>(parts: T[]): T[] {
  return [...parts].sort((a, b) => {
    const left = wizardExactSizeLabel(a.sizeLabel);
    const right = wizardExactSizeLabel(b.sizeLabel);
    if (Boolean(left) !== Boolean(right)) return left ? 1 : -1;
    return left && right ? left.localeCompare(right, undefined, { numeric: true }) : 0;
  });
}
