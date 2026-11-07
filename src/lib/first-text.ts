/** The first value with text in it. Blank strings are skipped, the same as `||`. */
export const firstText = (...values: (string | null | undefined)[]) =>
  values.find((value): value is string => !!value);
