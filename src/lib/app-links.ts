/** Shared address rules for named links to ForemanHQ resources and outside sites. */
export function isAppLink(value: string) {
  if (/[\u0000-\u0020\u007f\\]/.test(value)) return false;
  if (value.startsWith("/")) {
    if (
      value.startsWith("//") ||
      /%2f|%5c|%2e|%00/i.test(value.split(/[?#]/, 1)[0]!) ||
      value.split(/[?#]/, 1)[0]!.includes("..")
    )
      return false;
    const url = new URL(value, "https://foremanhq.invalid");
    if (url.pathname === "/dashboard" || url.pathname.startsWith("/dashboard/"))
      return true;
    return (
      /^\/api\/drawings\/attachments\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/i.test(
        value,
      ) ||
      /^\/api\/job-chat\/attachments\/[a-f0-9-]{36}$/i.test(value) ||
      /^\/api\/(job-rooms\/files|job-documents\/files)\/[a-zA-Z0-9_./%-]+$/.test(
        value,
      )
    );
  }
  try {
    const url = new URL(value);
    return (
      ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
