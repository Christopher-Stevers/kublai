import { NextResponse } from "next/server";

type ClientConsoleErrorPayload = {
  source?: unknown;
  message?: unknown;
  stack?: unknown;
  href?: unknown;
  userAgent?: unknown;
  at?: unknown;
};

function safeString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  return value.slice(0, maxLength);
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  try {
    const body = (await request.json()) as ClientConsoleErrorPayload;
    console.error(
      "[client-console-error]",
      JSON.stringify(
        {
          source: safeString(body.source, 80),
          message: safeString(body.message, 8000),
          stack: safeString(body.stack, 12000),
          href: safeString(body.href, 2000),
          userAgent: safeString(body.userAgent, 1000),
          at: safeString(body.at, 80),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("[client-console-error] failed to parse payload", error);
  }

  return NextResponse.json({ ok: true });
}
