/** One entry per part: words must match the same item, not unrelated rows. */
export function materialListPartSearchText(item: {
  partDefinitionDisplayName?: string | null;
  descriptionSnapshot?: string | null;
  supplierPartSku?: string | null;
}) {
  return normalize(
    [
      item.partDefinitionDisplayName,
      item.descriptionSnapshot,
      item.supplierPartSku,
    ]
      .filter(Boolean)
      .join(" "),
  );
}
function normalize(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
export function matchesMaterialListPart(
  texts: readonly string[] | undefined,
  query: string,
) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  return (
    !tokens.length ||
    !!texts?.some((text) =>
      tokens.every((token) =>
        /^\d+$/.test(token)
          ? text.split(" ").includes(token)
          : text.includes(token),
      ),
    )
  );
}
