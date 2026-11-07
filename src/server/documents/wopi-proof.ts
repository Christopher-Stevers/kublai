import {
  constants,
  createPublicKey,
  verify,
  type KeyObject,
} from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { DocumentEditorConfig } from "./editor-config";
import { getEditorDiscoveryXml } from "./editor-discovery";

const DOTNET_UNIX_EPOCH_TICKS = 621355968000000000n;
const MAX_CLOCK_SKEW_TICKS = 20n * 60n * 10_000_000n;
const MAX_TIMESTAMP = (1n << 63n) - 1n;
const REFRESH_COOLDOWN_MS = 30_000;
let lastRefresh: { origin: string; at: number } | undefined;

function denied(): never {
  throw new TRPCError({
    code: "UNAUTHORIZED",
    message: "The document editor request could not be verified.",
  });
}

function base64(value: string | null | undefined): Buffer | null {
  if (
    !value ||
    value.length > 2048 ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    return null;
  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function publicKey(
  modulus: string | undefined,
  exponent: string | undefined,
): KeyObject {
  const n = base64(modulus);
  const e = base64(exponent);
  if (!n || !e || n.length < 256 || n.length > 1024 || e.length > 8)
    throw new Error("Invalid proof key.");
  const key = createPublicKey({
    key: { kty: "RSA", n: n.toString("base64url"), e: e.toString("base64url") },
    format: "jwk",
  });
  if (
    key.asymmetricKeyType !== "rsa" ||
    (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
  )
    throw new Error("Invalid proof key.");
  return key;
}

function discoveryKeys(xml: string): { current: KeyObject; old?: KeyObject } {
  if (xml.length > 2 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)/i.test(xml))
    throw new Error("Unsafe proof discovery.");
  const tags = [
    ...xml
      .replace(/<!--[\s\S]*?-->/g, "")
      .matchAll(/<proof-key(?=\s|\/?>)([^>]*?)\/?\s*>/g),
  ];
  if (tags.length !== 1) throw new Error("Proof keys are required.");
  const attributes: Record<string, string> = {};
  for (const attribute of tags[0]![1]!.matchAll(
    /([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g,
  )) {
    if (Object.hasOwn(attributes, attribute[1]!))
      throw new Error("Duplicate proof key attribute.");
    attributes[attribute[1]!] = attribute[3]!;
  }
  const current = publicKey(attributes.modulus, attributes.exponent);
  if (
    attributes.oldmodulus !== undefined ||
    attributes.oldexponent !== undefined
  ) {
    return {
      current,
      old: publicKey(attributes.oldmodulus, attributes.oldexponent),
    };
  }
  return { current };
}

function lengthPrefixed(bytes: Buffer) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function signedData(request: Request, accessToken: string) {
  const raw = request.headers.get("x-wopi-timestamp");
  if (!raw || !/^\d{1,19}$/.test(raw)) return denied();
  const timestamp = BigInt(raw);
  const now = BigInt(Date.now()) * 10_000n + DOTNET_UNIX_EPOCH_TICKS;
  if (
    timestamp > MAX_TIMESTAMP ||
    timestamp < now - MAX_CLOCK_SKEW_TICKS ||
    timestamp > now + MAX_CLOCK_SKEW_TICKS ||
    !accessToken ||
    accessToken.length > 4096
  )
    return denied();
  const stamp = Buffer.alloc(8);
  stamp.writeBigInt64BE(timestamp);
  return { token: Buffer.from(accessToken, "utf8"), stamp };
}

function validSignature(
  data: Buffer,
  signature: Buffer | null,
  key: KeyObject | undefined,
) {
  if (!signature || !key) return false;
  try {
    return verify(
      "RSA-SHA256",
      data,
      { key, padding: constants.RSA_PKCS1_PADDING },
      signature,
    );
  } catch {
    return false;
  }
}

/** Verify editor identity independently of the user/file token and current ACL.
 * Proof format and rotation combinations follow the WOPI specification. The
 * external URL uses configured origin, never attacker-controlled proxy headers.
 */
export async function verifyWopiProof(
  request: Request,
  accessToken: string,
  config: DocumentEditorConfig,
): Promise<void> {
  if (!request.headers.get("x-wopi-proof")) return denied();
  const proof = base64(request.headers.get("x-wopi-proof"));
  const oldProof = base64(request.headers.get("x-wopi-proofold"));
  if (!proof && !oldProof) return denied();
  const { token, stamp } = signedData(request, accessToken);
  const incoming = new URL(request.url);
  const canonicalUrl =
    `${config.publicUrl.origin}${incoming.pathname}${incoming.search}`.toUpperCase();
  const data = Buffer.concat([
    lengthPrefixed(token),
    lengthPrefixed(Buffer.from(canonicalUrl, "utf8")),
    lengthPrefixed(stamp),
  ]);
  const verifyKeys = (xml: string) => {
    const keys = discoveryKeys(xml);
    // Deliberately do not accept old proof + old key: WOPI excludes that pair.
    return (
      validSignature(data, proof, keys.current) ||
      validSignature(data, oldProof, keys.current) ||
      validSignature(data, proof, keys.old)
    );
  };
  try {
    if (verifyKeys(await getEditorDiscoveryXml(config))) return;
    // Fetch once on an unknown key, with a process-local cooldown so malformed
    // signatures cannot force a discovery request on every authenticated call.
    const now = Date.now();
    if (
      lastRefresh?.origin !== config.collaboraUrl.href ||
      now - lastRefresh.at >= REFRESH_COOLDOWN_MS
    ) {
      lastRefresh = { origin: config.collaboraUrl.href, at: now };
      if (verifyKeys(await getEditorDiscoveryXml(config, true))) return;
    }
  } catch {
    return denied();
  }
  return denied();
}
