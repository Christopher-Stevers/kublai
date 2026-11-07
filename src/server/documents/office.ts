export type OfficeFileKind = "word" | "excel" | "powerpoint";

const extensions: Record<string, OfficeFileKind> = {
  doc: "word",
  docx: "word",
  docm: "word",
  odt: "word",
  rtf: "word",
  xls: "excel",
  xlsx: "excel",
  xlsm: "excel",
  xlsb: "excel",
  ods: "excel",
  csv: "excel",
  ppt: "powerpoint",
  pptx: "powerpoint",
  pptm: "powerpoint",
  ppsx: "powerpoint",
  odp: "powerpoint",
};
const uuid = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const documentId = new RegExp(`^(?:${uuid}|\\{${uuid}\\})$`, "i");
const sharePointHost =
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.sharepoint\.com$/i;
const sharePointDocumentPage = /\/_layouts\/15\/(?:doc2?|wopiframe)\.aspx$/i;
const sharePointFileLink = /^\/:([wxp]):(?:\/[rsgu]\/|[rsgu]\/).+/i;
const oneDriveItemId = /^[a-f0-9]{16}![a-z0-9_-]+$/i;
const unsafeText = /[\u0000-\u001f\u007f\\]/;

function fileKind(name: string): OfficeFileKind | null {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  return Object.hasOwn(extensions, extension)
    ? (extensions[extension] ?? null)
    : null;
}

function decoded(value: string): string {
  try {
    const result = decodeURIComponent(value);
    if (unsafeText.test(result)) throw new Error("Unsafe URL characters");
    return result;
  } catch {
    throw new Error(
      "Use a Microsoft file link without invalid or hidden characters.",
    );
  }
}

function isSourceDocument(value: string): boolean {
  return (
    documentId.test(value) ||
    (value.startsWith("/") &&
      !value.startsWith("//") &&
      !/[?#]/.test(value) &&
      fileKind(value) !== null)
  );
}

/**
 * Validate a durable Microsoft file link without fetching it or handling credentials.
 * This deliberately rejects shorteners, authentication links and generic Office viewer
 * URLs. Microsoft, independently of ForemanHQ, enforces access to the linked file.
 */
export function validateOfficeUrl(input: string): string {
  const trimmed = input.trim();
  if (
    trimmed.length > 4096 ||
    unsafeText.test(trimmed) ||
    !/^https:\/\//i.test(trimmed)
  ) {
    throw new Error("Use a full HTTPS SharePoint or OneDrive file link.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid Microsoft file link.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new Error(
      "Use a Microsoft file link without credentials, a custom port or a fragment.",
    );
  }

  const isSharePoint = sharePointHost.test(url.hostname);
  const isOneDrive = url.hostname === "onedrive.live.com";
  if (!isSharePoint && !isOneDrive) {
    throw new Error(
      "Open the file in SharePoint or OneDrive and copy its full browser address. Short links are not supported.",
    );
  }

  const pathname = decoded(url.pathname);
  // Query allowlisting prevents saving OAuth credentials or arbitrary redirect targets.
  // `e` is a SharePoint sharing-link parameter, not an OAuth access token. Its sharing
  // scope is still controlled by Microsoft and must be reviewed there by the owner.
  const parameters = new URLSearchParams();
  for (const [rawKey, rawValue] of url.searchParams) {
    const key = rawKey.toLowerCase();
    const value = decoded(rawValue);
    let valid = value.length <= 2048 && !parameters.has(key);
    if (isSharePoint) {
      switch (key) {
        case "sourcedoc":
          valid &&= isSourceDocument(value);
          break;
        case "file":
          valid &&= !/[\/?#]/.test(value) && fileKind(value) !== null;
          break;
        case "action":
          valid &&= /^(?:default|view|edit)$/i.test(value);
          break;
        case "web":
        case "csf":
          valid &&= /^(?:0|1)$/.test(value);
          break;
        case "mobileredirect":
          valid &&= /^(?:true|false|0|1)$/i.test(value);
          break;
        case "d":
          valid &&= /^[wxp]?[a-f0-9]{32}$/i.test(value);
          break;
        case "e":
          valid &&= /^[a-z0-9_-]{1,256}$/i.test(value);
          break;
        default:
          valid = false;
      }
    } else {
      switch (key) {
        case "id":
        case "resid":
          valid &&= oneDriveItemId.test(value);
          break;
        case "cid":
          valid &&= /^[a-f0-9]{16}$/i.test(value);
          break;
        case "action":
          valid &&= /^(?:default|view|edit)$/i.test(value);
          break;
        case "file":
          valid &&= !/[\/?#]/.test(value) && fileKind(value) !== null;
          break;
        default:
          valid = false;
      }
    }
    if (!valid) {
      throw new Error(
        "Use the file's browser address without sign-in tokens, redirects or extra query parameters.",
      );
    }
    parameters.set(key, value);
  }

  if (isSharePoint) {
    const isDocumentPage = sharePointDocumentPage.test(pathname);
    const isFilePath = fileKind(pathname) !== null;
    const isSharingLink =
      sharePointFileLink.test(pathname) && !/\.aspx(?:\/|$)/i.test(pathname);
    if (
      !(isDocumentPage && parameters.has("sourcedoc")) &&
      !isFilePath &&
      !isSharingLink
    ) {
      throw new Error(
        "Link an Office file, rather than a SharePoint folder, site or sign-in page.",
      );
    }
  } else if (
    !/^\/(?:edit(?:\.aspx)?|view\.aspx|redir)?\/?$/i.test(pathname) ||
    !(parameters.has("resid") || parameters.has("id"))
  ) {
    throw new Error(
      "Link an existing OneDrive file using its full browser address.",
    );
  }

  url.search = parameters.toString();
  return url.toString();
}
