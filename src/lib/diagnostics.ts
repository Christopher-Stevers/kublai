import { z } from "zod";
export const diagnosticFeature = z.enum([
  "jobs",
  "rooms",
  "drawings",
  "materials",
  "documents",
  "systems",
  "chat",
  "assets",
  "catalogue",
  "account",
  "other",
]);
export type DiagnosticFeature = z.infer<typeof diagnosticFeature>;
export const diagnosticEvent = z
  .object({
    kind: z.enum([
      "action_failed",
      "load_failed",
      "repeated_taps",
      "loading_stalled",
    ]),
    feature: diagnosticFeature,
    device: z.enum(["touch", "desktop"]),
    release: z
      .string()
      .regex(/^[a-f0-9]{7,40}$/)
      .or(z.literal("unknown")),
    code: z.enum([
      "none",
      "network",
      "unauthorized",
      "forbidden",
      "not_found",
      "conflict",
      "invalid",
      "rate_limited",
      "server",
      "unknown",
    ]),
    duration: z.enum(["unknown", "under_10s", "10_to_60s", "over_60s"]),
  })
  .strict();
export type DiagnosticEvent = z.infer<typeof diagnosticEvent>;
export function diagnosticFeatureFor(router: unknown): DiagnosticFeature {
  const map: Record<string, DiagnosticFeature> = {
    job: "jobs",
    rooms: "rooms",
    drawings: "drawings",
    drawingsWorkspace: "drawings",
    materialList: "materials",
    materialLists: "materials",
    jobDocuments: "documents",
    documents: "documents",
    jobSystems: "systems",
    chat: "chat",
    conversations: "chat",
    assets: "assets",
    part: "catalogue",
    catalogue: "catalogue",
    supplier: "catalogue",
    user: "account",
  };
  return typeof router === "string" ? (map[router] ?? "other") : "other";
}
export function diagnosticErrorCode(error: unknown): DiagnosticEvent["code"] {
  const status = (error as { data?: { httpStatus?: number } } | null)?.data
    ?.httpStatus;
  if (!status) return "unknown";
  if (status >= 500) return "server";
  return (
    (
      {
        400: "invalid",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        429: "rate_limited",
      } as const
    )[status as 400] ?? "unknown"
  );
}
export const diagnosticStorageKey = (account: string) =>
  `foremanhq:diagnostics:${account}`;
export function diagnosticsEnabled(account: string) {
  try {
    return window.localStorage.getItem(diagnosticStorageKey(account)) !== "off";
  } catch {
    return false;
  }
}
