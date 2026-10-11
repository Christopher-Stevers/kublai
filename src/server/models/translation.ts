import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { MAX_MODEL_BYTES, MODEL_CHUNK_BYTES } from "~/lib/bim/types";
import { readApsCredentials, type ApsCredentials } from "./connection";
const apiRoot = "https://developer.api.autodesk.com";
export const apsConfigured = async (organizationId: string) =>
  Boolean(await readApsCredentials(organizationId));
const cached = new Map<
  string,
  { value: string; until: number; clientId: string }
>();
export async function verifyApsCredentials(credentials: ApsCredentials) {
  const response = await fetch(apiRoot + "/authentication/v2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          credentials.clientId + ":" + credentials.clientSecret,
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "data:read data:write data:create bucket:create bucket:read",
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw Error(
      "Autodesk authentication failed. Check the client ID and secret.",
    );
  const body = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!body.access_token)
    throw Error("Autodesk returned an invalid access token.");
  return {
    value: body.access_token,
    until: Date.now() + (Math.min(body.expires_in ?? 300, 3600) - 60) * 1000,
    clientId: credentials.clientId,
  };
}
async function token(organizationId: string) {
  const credentials = await readApsCredentials(organizationId);
  if (!credentials)
    throw Error("Connect Autodesk before converting native Revit files.");
  const saved = cached.get(organizationId);
  if (
    saved?.clientId === credentials.clientId &&
    saved.until > Date.now()
  )
    return saved.value;
  const next = await verifyApsCredentials(credentials);
  if (cached.size > 100) cached.clear();
  cached.set(organizationId, next);
  return next.value;
}
export function clearApsToken(organizationId: string) {
  cached.delete(organizationId);
}
async function api(
  organizationId: string,
  path: string,
  init: RequestInit = {},
  allowConflict = false,
) {
  const response = await fetch(apiRoot + path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: "Bearer " + (await token(organizationId)),
    },
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok && !(allowConflict && response.status === 409))
    throw Error(
      `Autodesk request failed (${response.status}). Check the APS account and translation service.`,
    );
  return response;
}
export function trustedAutodeskDownload(value: string, upload = false) {
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !(upload
      ? /\.s3[.-][a-z0-9.-]+\.amazonaws\.com$/.test(h) ||
        h.endsWith(".s3.amazonaws.com")
      : h === "cdn.derivative.autodesk.com" ||
        h.endsWith(".autodesk.com") ||
        h.endsWith(".cloudfront.net"))
  )
    throw Error("Autodesk returned an unsupported storage address.");
  return u;
}
export async function startRevitTranslation(
  organizationId: string,
  modelId: string,
  source: string,
  size: number,
) {
  const credentials = await readApsCredentials(organizationId);
  if (!credentials) throw Error("Connect Autodesk first.");
  const bucket =
    "foremanhq-" +
    createHash("sha256")
      .update(credentials.clientId)
      .digest("hex")
      .slice(0, 12) +
    "-" +
    organizationId.replaceAll("-", "");
  await api(
    organizationId,
    "/oss/v2/buckets",
    {
      method: "POST",
      body: JSON.stringify({ bucketKey: bucket, policyKey: "persistent" }),
    },
    true,
  );
  const object = modelId + ".rvt",
    base = `/oss/v2/buckets/${bucket}/objects/${object}`;
  const count = Math.ceil(size / MODEL_CHUNK_BYTES);
  let uploadKey: string | undefined;
  const file = await open(source, "r");
  try {
    for (let first = 0; first < count; first += 25) {
      const length = Math.min(25, count - first);
      const signed = (await (
        await api(
          organizationId,
          base +
            `/signeds3upload?parts=${length}&firstPart=${first + 1}${uploadKey ? "&uploadKey=" + encodeURIComponent(uploadKey) : ""}`,
        )
      ).json()) as { uploadKey?: string; urls?: string[] };
      if (!signed.uploadKey || signed.urls?.length !== length)
        throw Error("Autodesk upload setup failed.");
      uploadKey = signed.uploadKey;
      for (let j = 0; j < length; j++) {
        const i = first + j;
        const bytes = Buffer.alloc(
          Math.min(MODEL_CHUNK_BYTES, size - i * MODEL_CHUNK_BYTES),
        );
        const read = await file.read(
          bytes,
          0,
          bytes.length,
          i * MODEL_CHUNK_BYTES,
        );
        if (read.bytesRead !== bytes.length)
          throw Error("The stored Revit model is incomplete.");
        let success = false;
        for (let attempt = 0; attempt < 3; attempt++) {
          const response = await fetch(
            trustedAutodeskDownload(signed.urls[j]!, true),
            {
              method: "PUT",
              body: bytes,
              redirect: "error",
              signal: AbortSignal.timeout(60000),
            },
          );
          if (response.ok) {
            success = true;
            break;
          }
          if (response.status < 500 && response.status !== 429) break;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * 2 ** attempt),
          );
        }
        if (!success)
          throw Error("Autodesk model upload failed. Retry conversion.");
      }
    }
  } finally {
    await file.close();
  }
  const uploaded = (await (
    await api(organizationId, base + "/signeds3upload", {
      method: "POST",
      body: JSON.stringify({ uploadKey }),
    })
  ).json()) as { objectId?: string };
  if (!uploaded.objectId)
    throw Error("Autodesk did not return a model identifier.");
  const urn = Buffer.from(uploaded.objectId).toString("base64url");
  await api(organizationId, "/modelderivative/v2/designdata/job", {
    method: "POST",
    body: JSON.stringify({
      input: { urn },
      output: { formats: [{ type: "ifc" }] },
    }),
  });
  return urn;
}
type ManifestNode = {
  urn?: string;
  outputType?: string;
  status?: string;
  progress?: string;
  children?: ManifestNode[];
  derivatives?: ManifestNode[];
};
export function ifcDerivative(node: ManifestNode): string | null {
  if (node.urn && /\.ifc$/i.test(node.urn)) return node.urn;
  for (const child of [...(node.derivatives ?? []), ...(node.children ?? [])]) {
    const found = ifcDerivative(child);
    if (found) return found;
  }
  return null;
}
export async function readRevitTranslation(
  organizationId: string,
  urn: string,
): Promise<
  | { status: "processing" | "failed"; message: string }
  | { status: "ready"; bytes: Uint8Array }
> {
  const manifest = (await (
    await api(
      organizationId,
      `/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest`,
    )
  ).json()) as ManifestNode;
  if (manifest.status === "failed" || manifest.status === "timeout")
    return {
      status: "failed",
      message:
        "Autodesk could not translate this Revit file. Check its Revit version, linked files and export settings, or upload an IFC export.",
    };
  if (manifest.status !== "success")
    return {
      status: "processing",
      message: `Autodesk is preparing the model${manifest.progress ? " · " + manifest.progress : ""}`,
    };
  const derivative = ifcDerivative(manifest);
  if (!derivative)
    return {
      status: "failed",
      message:
        "The translation completed without an IFC model. Export IFC from Revit and upload that file.",
    };
  const signed = await api(
    organizationId,
    `/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest/${encodeURIComponent(derivative)}/signedcookies`,
  );
  const data = (await signed.json()) as { url?: string };
  if (!data.url) throw Error("Autodesk did not return a model download.");
  const url = trustedAutodeskDownload(data.url);
  for (const cookie of signed.headers.getSetCookie()) {
    const pair = cookie.split(";")[0]!;
    const equal = pair.indexOf("=");
    const key = pair.slice(0, equal).replace("CloudFront-", "");
    if (["Policy", "Signature", "Key-Pair-Id"].includes(key))
      url.searchParams.set(key, pair.slice(equal + 1));
  }
  const response = await fetch(url, {
    redirect: "error",
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok || !response.body)
    throw Error("The converted model could not be downloaded.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = response.body.getReader();
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    length += r.value.byteLength;
    if (length > MAX_MODEL_BYTES) {
      await reader.cancel();
      throw Error(
        "The converted model exceeds 250 MB. Export individual disciplines or floors.",
      );
    }
    chunks.push(r.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { status: "ready", bytes };
}
