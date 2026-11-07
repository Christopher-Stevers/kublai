import { TRPCError } from "@trpc/server";
import type { DocumentEditorStatus } from "./types";

export type DocumentEditorConfig = {
  collaboraUrl: URL;
  publicUrl: URL;
  secret: string;
};
export const EDITOR_EXTENSIONS = [
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
] as const;
export type EditorExtension = (typeof EDITOR_EXTENSIONS)[number];
export function editorExtension(name: string): EditorExtension | null {
  const extension = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return EDITOR_EXTENSIONS.includes(extension as EditorExtension)
    ? (extension as EditorExtension)
    : null;
}
function configuredUrl(value: string, allowPath: boolean) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" &&
      !(
        process.env.NODE_ENV !== "production" &&
        local &&
        url.protocol === "http:"
      )) ||
    (!allowPath && url.pathname !== "/")
  )
    throw new Error(
      "Editor URLs must use HTTPS without credentials, queries or fragments.",
    );
  return url;
}
export function getDocumentEditorConfig(): DocumentEditorConfig {
  try {
    const secret = process.env.DOCUMENT_EDITOR_SECRET ?? "";
    if (Buffer.byteLength(secret) < 32)
      throw new Error("Missing editor signing secret.");
    return {
      collaboraUrl: configuredUrl(process.env.COLLABORA_URL ?? "", true),
      publicUrl: configuredUrl(process.env.FOREMANHQ_PUBLIC_URL ?? "", false),
      secret,
    };
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The document editor is not configured. Set up the Collabora service and document editor environment first.",
    });
  }
}
export function documentEditorStatus(): DocumentEditorStatus {
  try {
    getDocumentEditorConfig();
    return { configured: true, provider: "collabora" };
  } catch {
    return {
      configured: false,
      provider: "collabora",
      reason:
        "The live document editor has not been configured for this server.",
    };
  }
}
