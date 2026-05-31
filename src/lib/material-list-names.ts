export function formatMaterialListDate(from = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(from);
}

export function isDefaultMaterialListName(name: string | null | undefined) {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === "Material List") return true;
  return /^[A-Z][a-z]+ \d{1,2}, \d{4}(?: - \d+)?$/.test(trimmed);
}

export function getNextMaterialListNameFromNames(
  existingNames: Iterable<string | null | undefined>,
  from = new Date(),
) {
  const dateName = formatMaterialListDate(from);
  const names = new Set(
    Array.from(existingNames, (name) => name?.trim()).filter(Boolean),
  );

  if (!names.has(dateName)) return dateName;

  let suffix = 2;
  while (names.has(`${dateName} - ${suffix}`)) {
    suffix += 1;
  }

  return `${dateName} - ${suffix}`;
}
