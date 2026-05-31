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

function isKnownRecoverableClientError(message: string | undefined) {
  if (typeof message !== "string") return false;

  const isMaterialListReplicacheMessage = message.includes(
    "name=foremenhq-material-lists",
  );
  if (!isMaterialListReplicacheMessage) return false;

  return (
    message.includes("Client state not found on server") ||
    (message.includes("IDBNotFoundError") &&
      message.includes("Replicache IndexedDB not found: rep:foremenhq-material-lists:"))
  );
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ClientConsoleErrorPayload;
    const message = safeString(body.message, 8000);
    if (!isKnownRecoverableClientError(message)) {
      console.error(
        "[client-console-error]",
        JSON.stringify(
          {
            source: safeString(body.source, 80),
            message,
            stack: safeString(body.stack, 12000),
            href: safeString(body.href, 2000),
            userAgent: safeString(body.userAgent, 1000),
            at: safeString(body.at, 80),
          },
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error("[client-console-error] failed to parse payload", error);
  }

  return NextResponse.json({ ok: true });
}
