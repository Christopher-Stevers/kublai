const TIME_ZONE = "America/Toronto";

export function formatMaterialListDate(from = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(from);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part("weekday")} ${part("day")}/${part("month")}/${part("year")}`;
}

export function isDefaultMaterialListName(name: string | null | undefined) {
  const trimmed = name?.trim();
  if (!trimmed || trimmed === "Material List") return true;
  // Keep accepting names queued by older offline clients.
  return (
    /^[A-Z][a-z]+ \d{1,2}, \d{4}(?: - \d+)?$/.test(trimmed) ||
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{2}\/\d{2}\/\d{2}(?:-[1-9]\d*)?$/.test(
      trimmed,
    )
  );
}

export function getNextMaterialListNameFromNames(
  existingNames: Iterable<string | null | undefined>,
  from = new Date(),
) {
  const dateName = formatMaterialListDate(from);
  const legacyDateName = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(from);
  let highest = 0;
  for (const existingName of existingNames) {
    const name = existingName?.trim();
    if (!name) continue;
    if (name === dateName || name === legacyDateName) {
      highest = Math.max(highest, 1);
      continue;
    }
    const suffix = name.startsWith(`${dateName}-`)
      ? name.slice(dateName.length + 1)
      : name.startsWith(`${legacyDateName} - `)
        ? name.slice(legacyDateName.length + 3)
        : "";
    const number = Number(suffix);
    if (/^[1-9]\d*$/.test(suffix) && Number.isSafeInteger(number)) {
      highest = Math.max(highest, number);
    }
  }
  return highest === 0 ? dateName : `${dateName}-${highest + 1}`;
}
