import { timingSafeEqual } from "node:crypto";
import { asc, eq, isNotNull } from "drizzle-orm";

import { db } from "~/server/db";
import { users } from "~/server/db/schema";

const AGENT_AUTH_COOKIE = "foremenhq_agent_auth";
const AGENT_AUTH_HEADER = "x-foremenhq-agent-auth";
const BETA_MARKER_COOKIE = "foremenhq_beta_access";
const DEFAULT_BETA_AUTH_EMAIL = "halvorhalstrom@gmail.com";

function isAgentBypassEnabled() {
  return process.env.FOREMENHQ_AGENT_AUTH_BYPASS === "true";
}

function getConfiguredSecret() {
  return process.env.FOREMENHQ_AGENT_AUTH_SECRET?.trim() ?? "";
}

function safeTokenEquals(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);

  if (candidateBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(candidateBuffer, expectedBuffer);
}

function extractCookie(headers: Headers, name: string) {
  const rawCookie = headers.get("cookie");
  if (!rawCookie) return null;

  const cookies = rawCookie.split(";").map((part) => part.trim());
  const prefix = `${name}=`;
  const match = cookies.find((part) => part.startsWith(prefix));
  if (!match) return null;

  return decodeURIComponent(match.slice(prefix.length));
}

export function hasValidAgentAuthBypass(headers: Headers) {
  if (!isAgentBypassEnabled()) return false;

  const expectedSecret = getConfiguredSecret();
  if (expectedSecret.length < 32) return false;

  const providedToken =
    headers.get(AGENT_AUTH_HEADER)?.trim() ??
    extractCookie(headers, AGENT_AUTH_COOKIE)?.trim() ??
    "";

  if (!providedToken) return false;
  return safeTokenEquals(providedToken, expectedSecret);
}

export async function getAgentBypassUser(headers: Headers) {
  if (!hasValidAgentAuthBypass(headers)) return null;

  const isBetaAccess = extractCookie(headers, BETA_MARKER_COOKIE) === "1";
  const preferredEmail = (
    isBetaAccess
      ? (process.env.FOREMENHQ_BETA_AUTH_EMAIL ?? DEFAULT_BETA_AUTH_EMAIL)
      : process.env.DEV_AUTH_EMAIL
  )
    ?.trim()
    .toLowerCase();

  if (preferredEmail) {
    const [preferredUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, preferredEmail))
      .limit(1);

    if (preferredUser?.organizationId) {
      return preferredUser;
    }
  }

  const [fallbackUser] = await db
    .select()
    .from(users)
    .where(isNotNull(users.organizationId))
    .orderBy(asc(users.createdAt))
    .limit(1);

  return fallbackUser ?? null;
}

export { AGENT_AUTH_COOKIE, AGENT_AUTH_HEADER };
