import { NextResponse, type NextRequest } from "next/server";

import { AGENT_AUTH_COOKIE } from "~/server/utils/get-agent-bypass-user";

const BETA_MARKER_COOKIE = "foremenhq_beta_access";
const DEFAULT_BETA_CODE = "foremen2024";
const DEFAULT_PUBLIC_APP_URL = "https://foremanhq.stellarator.work";

function getPublicOrigin(request: NextRequest) {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configuredOrigin) return configuredOrigin.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host")?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.trim();

  if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    return `${forwardedProto || "https"}://${host}`;
  }

  return DEFAULT_PUBLIC_APP_URL;
}

function isProductionRequest(request: NextRequest) {
  return (
    getPublicOrigin(request).startsWith("https://") ||
    process.env.NODE_ENV === "production"
  );
}

export function GET(request: NextRequest) {
  const providedCode = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  const expectedCode =
    process.env.FOREMENHQ_BETA_ACCESS_CODE?.trim() || DEFAULT_BETA_CODE;
  const authSecret = process.env.FOREMENHQ_AGENT_AUTH_SECRET?.trim() ?? "";

  const publicOrigin = getPublicOrigin(request);

  if (providedCode !== expectedCode || authSecret.length < 32) {
    return NextResponse.redirect(new URL("/sign-in", publicOrigin));
  }

  const response = NextResponse.redirect(new URL("/dashboard", publicOrigin));
  const secure = isProductionRequest(request);
  const maxAge = 60 * 60 * 24 * 30;

  response.cookies.set(AGENT_AUTH_COOKIE, authSecret, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });
  response.cookies.set(BETA_MARKER_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge,
  });

  return response;
}
