/** Grouped summaries and full offline rows use the same weighted counters. */
export function facetCount(part: { count?: number }) {
  return part.count ?? 1;
}

export function expandLegacyFacets<T extends { count: number }>(rows: T[]) {
  return rows.flatMap(({ count, ...row }) =>
    Array.from({ length: count }, () => ({ ...row, count: 1 })),
  );
}
