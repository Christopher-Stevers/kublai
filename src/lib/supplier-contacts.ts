export type SupplierContactEmailRole = "to" | "cc";

export interface SupplierContact {
  [key: string]: string | null;
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  emailRole: SupplierContactEmailRole;
}

export type SupplierContactInput = Partial<SupplierContact> | null | undefined;

export function createEmptySupplierContact(): SupplierContact {
  return {
    id: crypto.randomUUID(),
    name: null,
    email: null,
    phone: null,
    emailRole: "to",
  };
}

export function normalizeSupplierContacts(
  contacts: unknown,
  legacy?: {
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  },
): SupplierContact[] {
  const normalized = Array.isArray(contacts)
    ? contacts
        .map((contact): SupplierContact | null => {
          if (!contact || typeof contact !== "object") return null;
          const item = contact as SupplierContactInput;
          const name = cleanNullableString(item?.name);
          const email = cleanNullableString(item?.email);
          const phone = cleanNullableString(item?.phone);
          if (!name && !email && !phone) return null;

          return {
            id: cleanNullableString(item?.id) ?? crypto.randomUUID(),
            name,
            email,
            phone,
            emailRole: item?.emailRole === "cc" ? "cc" : "to",
          };
        })
        .filter((contact): contact is SupplierContact => !!contact)
    : [];

  if (normalized.length > 0) return normalized;

  const legacyName = cleanNullableString(legacy?.contactName);
  const legacyEmail = cleanNullableString(legacy?.contactEmail);
  const legacyPhone = cleanNullableString(legacy?.contactPhone);
  if (!legacyName && !legacyEmail && !legacyPhone) return [];

  return [
    {
      id: crypto.randomUUID(),
      name: legacyName,
      email: legacyEmail,
      phone: legacyPhone,
      emailRole: "to",
    },
  ];
}

export function getPrimarySupplierContact(contacts: SupplierContact[]) {
  return contacts[0] ?? null;
}

export function getSupplierEmailRecipients(contacts: SupplierContact[]) {
  return {
    to: contacts
      .filter((contact) => contact.emailRole === "to" && contact.email)
      .map((contact) => contact.email!),
    cc: contacts
      .filter((contact) => contact.emailRole === "cc" && contact.email)
      .map((contact) => contact.email!),
  };
}

export function formatSupplierGreetingName(contacts: SupplierContact[]) {
  const names = contacts
    .filter((contact) => contact.emailRole === "to" && contact.email)
    .map((contact) => contact.name?.trim())
    .filter((name): name is string => !!name)
    .map((name) => firstName(name));

  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;

  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function cleanNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0] ?? name.trim();
}
