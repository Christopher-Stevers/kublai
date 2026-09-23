type SearchableEmail = {
  subject: string;
  body: string;
  to?: string[];
  cc?: string[];
};
type SearchableOrder = {
  orderNumber?: string | null;
  job?: { name: string } | null;
  materialList?: { name: string } | null;
  supplier?: { name: string } | null;
  notes?: string | null;
  sentTo?: string | null;
  searchableItems?: string;
  items?: Array<{
    quantity: string | number;
    description: string | null;
    supplierSku: string | null;
  }>;
};
function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function orderSearchHaystack(order: SearchableOrder, email?: SearchableEmail) {
  return normalizeSearchText(
    [
      order.orderNumber,
      order.job?.name,
      order.materialList?.name,
      order.supplier?.name,
      order.notes,
      order.sentTo,
      email?.subject,
      email?.body,
      email?.to?.join(" "),
      email?.cc?.join(" "),
      order.searchableItems,
      ...(order.items ?? []).flatMap((item) => [
        item.quantity,
        item.description,
        item.supplierSku,
      ]),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function scoreOrderSearch(
  order: SearchableOrder,
  query: string,
  email?: SearchableEmail,
) {
  const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 1;
  const haystack = orderSearchHaystack(order, email);
  const words = haystack.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) {
      score += haystack.split(token).length > 2 ? 3 : 2;
      continue;
    }
    const prefixMatch = words.some(
      (word) =>
        word.startsWith(token) || (token.length > 2 && token.startsWith(word)),
    );
    if (!prefixMatch) return 0;
    score += 1;
  }
  return score;
}
