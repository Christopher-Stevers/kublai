import { TRPCError } from "@trpc/server";
import type { DocumentEditorConfig, EditorExtension } from "./editor-config";

function decodeAttribute(input: string) {
  return input.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const named: Record<string, string> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      if (named[entity]) return named[entity];
      const code =
        entity[2]?.toLowerCase() === "x"
          ? parseInt(entity.slice(3, -1), 16)
          : parseInt(entity.slice(2, -1), 10);
      if (!Number.isInteger(code) || code < 32 || code > 0x10ffff)
        throw new Error("Invalid XML character.");
      return String.fromCodePoint(code);
    },
  );
}
/** Discovery needs only bounded action attributes. No DTD, entities or XML expansion executes. */
export function parseEditorDiscovery(
  xml: string,
  config: DocumentEditorConfig,
  extension: EditorExtension,
  mode: "edit" | "view",
  wopiSrc: string,
) {
  if (xml.length > 2 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error("Unsafe editor discovery response.");
  const clean = xml.replace(/<!--[\s\S]*?-->/g, "");
  const candidates: { name: string; url: string }[] = [];
  for (const action of clean.matchAll(/<action\b([^>]*?)\/?\s*>/g)) {
    const attributes: Record<string, string> = {};
    for (const attribute of action[1]!.matchAll(
      /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g,
    )) {
      if (Object.hasOwn(attributes, attribute[1]!))
        throw new Error("Duplicate discovery attribute.");
      attributes[attribute[1]!] = decodeAttribute(attribute[3]!);
    }
    if (
      attributes.ext === extension &&
      attributes.urlsrc &&
      (attributes.name === "edit" || attributes.name === "view")
    )
      candidates.push({ name: attributes.name, url: attributes.urlsrc });
  }
  const selected =
    candidates.find((candidate) => candidate.name === mode) ??
    (mode === "view"
      ? candidates.find((candidate) => candidate.name === "edit")
      : undefined);
  if (!selected)
    throw new Error("The configured editor does not support this file type.");
  const source = selected.url.replace(/<[^>]*>/g, "");
  const url = new URL(source);
  if (
    url.origin !== config.collaboraUrl.origin ||
    url.username ||
    url.password ||
    url.hash ||
    /[<>]/.test(source)
  )
    throw new Error(
      "The editor discovery URL must belong to the configured Collabora origin.",
    );
  url.searchParams.set("WOPISrc", wopiSrc);
  url.searchParams.set("permission", mode === "view" ? "readonly" : "edit");
  url.searchParams.set("closebutton", "1");
  return url.toString();
}
let cachedDiscovery: { key: string; expires: number; xml: string } | undefined;
export async function getEditorDiscoveryXml(
  config: DocumentEditorConfig,
  forceRefresh = false,
) {
  const discovery = new URL(
    `${config.collaboraUrl.pathname.replace(/\/$/, "")}/hosting/discovery`,
    config.collaboraUrl.origin,
  );
  try {
    let xml =
      !forceRefresh &&
      cachedDiscovery?.key === discovery.href &&
      cachedDiscovery.expires > Date.now()
        ? cachedDiscovery.xml
        : undefined;
    if (!xml) {
      const response = await fetch(discovery, {
        redirect: "error",
        signal: AbortSignal.timeout(10_000),
        cache: "no-store",
      });
      if (
        !response.ok ||
        !response.body ||
        Number(response.headers.get("content-length") ?? 0) > 2 * 1024 * 1024
      )
        throw new Error("Editor discovery failed.");
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.length;
          if (size > 2 * 1024 * 1024) {
            await reader.cancel();
            throw new Error("Discovery exceeds size limit.");
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      xml = Buffer.concat(chunks).toString("utf8");
      cachedDiscovery = {
        key: discovery.href,
        expires: Date.now() + 5 * 60_000,
        xml,
      };
    }
    return xml;
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The live document editor is unavailable or does not support this file. Try again after the Collabora service is running.",
    });
  }
}
export async function discoverEditorAction(
  config: DocumentEditorConfig,
  extension: EditorExtension,
  mode: "edit" | "view",
  wopiSrc: string,
) {
  try {
    return parseEditorDiscovery(
      await getEditorDiscoveryXml(config),
      config,
      extension,
      mode,
      wopiSrc,
    );
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The live document editor is unavailable or does not support this file. Try again after the Collabora service is running.",
    });
  }
}
