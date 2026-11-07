import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { EDITOR_EXTENSIONS, type DocumentEditorConfig } from "./editor-config";

export const EDITOR_TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;
const claimsSchema = z
  .object({
    version: z.literal(1),
    audience: z.string().url(),
    organizationId: z.uuid(),
    jobId: z.uuid(),
    documentId: z.uuid(),
    userId: z.string().min(1).max(255),
    simulationId: z.uuid().optional(),
    mode: z.enum(["view", "edit"]),
    extension: z.enum(EDITOR_EXTENSIONS),
    issuedAt: z.number().int().positive(),
    expiresAt: z.number().int().positive(),
    nonce: z.uuid(),
  })
  .strict();
export type EditorTokenClaims = z.infer<typeof claimsSchema>;
export type EditorTokenScope = Pick<
  EditorTokenClaims,
  | "organizationId"
  | "jobId"
  | "documentId"
  | "userId"
  | "mode"
  | "extension"
  | "simulationId"
>;
function signature(payload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`foremanhq-wopi-v1:${payload}`)
    .digest();
}
function invalid(): never {
  throw new TRPCError({
    code: "UNAUTHORIZED",
    message:
      "The document editor session is invalid or expired. Reopen the editor from Documents.",
  });
}
export function issueEditorToken(
  config: DocumentEditorConfig,
  scope: EditorTokenScope,
  now = Date.now(),
) {
  const claims = claimsSchema.parse({
    ...scope,
    version: 1,
    audience: config.publicUrl.origin,
    issuedAt: now,
    expiresAt: now + EDITOR_TOKEN_LIFETIME_MS,
    nonce: randomUUID(),
  });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return {
    accessToken: `${payload}.${signature(payload, config.secret).toString("base64url")}`,
    accessTokenTtl: claims.expiresAt,
  };
}
export function verifyEditorToken(
  config: DocumentEditorConfig,
  token: string,
  expected: { documentId: string; jobId: string },
  now = Date.now(),
): EditorTokenClaims {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))
    return invalid();
  const [payload, supplied] = token.split(".") as [string, string];
  const received = Buffer.from(supplied, "base64url");
  const calculated = signature(payload, config.secret);
  if (
    received.length !== calculated.length ||
    !timingSafeEqual(received, calculated)
  )
    return invalid();
  let claims: EditorTokenClaims;
  try {
    claims = claimsSchema.parse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    return invalid();
  }
  if (
    claims.audience !== config.publicUrl.origin ||
    claims.documentId !== expected.documentId ||
    claims.jobId !== expected.jobId ||
    claims.expiresAt <= now ||
    claims.issuedAt > now + 30_000 ||
    claims.expiresAt <= claims.issuedAt ||
    claims.expiresAt - claims.issuedAt !== EDITOR_TOKEN_LIFETIME_MS
  )
    return invalid();
  return claims;
}
export function editorRequestToken(request: Request) {
  const query = new URL(request.url).searchParams.getAll("access_token");
  const authorization = request.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ")
    ? authorization.slice(7)
    : null;
  if (query.length > 1 || (query[0] && bearer && query[0] !== bearer))
    return invalid();
  const token = query[0] ?? bearer;
  if (!token) return invalid();
  return token;
}
