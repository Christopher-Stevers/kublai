function encodeMailtoParam(value: string) {
  return encodeURIComponent(value);
}

function cleanEmailList(emails: string[]) {
  return emails.map((email) => email.trim()).filter(Boolean);
}

export type EmailClientPreference = "default" | "gmail" | "outlook";

export const EMAIL_CLIENT_STORAGE_KEY = "foremenhq.emailClient";

export const EMAIL_CLIENT_OPTIONS: Array<{
  value: EmailClientPreference;
  label: string;
}> = [
  { value: "default", label: "Default mail app" },
  { value: "gmail", label: "Gmail in browser" },
  { value: "outlook", label: "Outlook in browser" },
];

export function isEmailClientPreference(
  value: string | null,
): value is EmailClientPreference {
  return value === "default" || value === "gmail" || value === "outlook";
}

export function getPreferredEmailClient(): EmailClientPreference {
  if (typeof window === "undefined") return "default";
  const stored = window.localStorage.getItem(EMAIL_CLIENT_STORAGE_KEY);
  return isEmailClientPreference(stored) ? stored : "default";
}

export function setPreferredEmailClient(client: EmailClientPreference) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EMAIL_CLIENT_STORAGE_KEY, client);
}

function encodeQuery(params: Array<[string, string]>) {
  return params
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${encodeMailtoParam(value)}`)
    .join("&");
}

export function buildEmailComposeUrl({
  to,
  cc = [],
  subject,
  body,
  client = "default",
}: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  client?: EmailClientPreference;
}) {
  const toValue = cleanEmailList(to).join(",");
  const ccValue = cleanEmailList(cc).join(",");

  if (client === "gmail") {
    return `https://mail.google.com/mail/?${encodeQuery([
      ["view", "cm"],
      ["fs", "1"],
      ["to", toValue],
      ["cc", ccValue],
      ["su", subject],
      ["body", body],
    ])}`;
  }

  if (client === "outlook") {
    return `https://outlook.office.com/mail/deeplink/compose?${encodeQuery([
      ["to", toValue],
      ["cc", ccValue],
      ["subject", subject],
      ["body", body],
    ])}`;
  }

  const params: Array<[string, string]> = [
    ["subject", subject],
    ["body", body],
  ];
  if (ccValue) params.push(["cc", ccValue]);

  return `mailto:${toValue}?${encodeQuery(params)}`;
}

export function buildMailtoUrl(args: {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}) {
  return buildEmailComposeUrl(args);
}
