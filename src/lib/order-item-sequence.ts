/** Reorder authorized rows only; missing/new rows stay at the end in their existing order. */
export function orderItemSequence<T>(items: readonly T[], ids: readonly string[] | undefined, key: (item: T) => string | null | undefined): T[] {
  const rank = new Map<string, number>();
  ids?.forEach((id, index) => { if (!rank.has(id)) rank.set(id, index); });
  return [...items].sort((a, b) => (rank.get(key(a) ?? "") ?? Infinity) - (rank.get(key(b) ?? "") ?? Infinity));
}
