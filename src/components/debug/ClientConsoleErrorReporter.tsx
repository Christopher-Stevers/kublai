"use client";

import { useEffect } from "react";

type ClientErrorPayload = {
  source: "console.error" | "window.error" | "unhandledrejection";
  message: string;
  stack?: string;
  href: string;
  userAgent: string;
  at: string;
};

function serializeValue(value: unknown): string {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`;
  }

  if (typeof value === "string") return value;

  try {
    const seen = new WeakSet<object>();
    const serialized = JSON.stringify(value, (_key, nestedValue: unknown) => {
      if (nestedValue instanceof Error) {
        return {
          name: nestedValue.name,
          message: nestedValue.message,
          stack: nestedValue.stack,
        };
      }

      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) return "[Circular]";
        seen.add(nestedValue);
      }

      return nestedValue;
    });

    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function windowErrorMessage(event: ErrorEvent): string {
  const eventMessage = event.message || "Uncaught error";
  const serializedError = serializeValue(event.error);

  if (!event.error || serializedError === "undefined") return eventMessage;

  // Browsers stringify thrown plain objects as `Uncaught [object Object]`, which
  // is basically useless for repairing field failures. Include the actual thrown
  // value so the watchdog gets the object payload instead of a dead-end message.
  if (eventMessage.includes("[object Object]")) {
    return `${eventMessage}: ${serializedError}`;
  }

  return serializedError && serializedError !== eventMessage
    ? `${eventMessage}: ${serializedError}`
    : eventMessage;
}

function errorPayload(
  source: ClientErrorPayload["source"],
  message: string,
  stack?: string,
): ClientErrorPayload {
  return {
    source,
    message: message.slice(0, 8000),
    stack: stack?.slice(0, 12000),
    href: window.location.href,
    userAgent: window.navigator.userAgent,
    at: new Date().toISOString(),
  };
}

function isIgnoredConsoleError(message: string) {
  // tRPC's dev logger writes handled query failures to console.error. During dev-server
  // restarts or page transitions those often show up as transient `Failed to fetch`
  // diagnostics, not app exceptions. Keep reporting real unhandled errors/rejections,
  // but don't feed loggerLink noise back into the repair watchdog.
  return message.startsWith("%c << ") && message.includes("TRPCClientError");
}

function sendClientError(payload: ClientErrorPayload) {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const sent = navigator.sendBeacon(
      "/api/debug/client-console-error",
      new Blob([body], { type: "application/json" }),
    );
    if (sent) return;
  }

  void fetch("/api/debug/client-console-error", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}

export function ClientConsoleErrorReporter() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const originalConsoleError = console.error;
    let lastSignature = "";
    let lastSentAt = 0;

    const report = (payload: ClientErrorPayload) => {
      const signature = `${payload.source}:${payload.message}:${payload.stack ?? ""}`.slice(
        0,
        2000,
      );
      const now = Date.now();
      if (signature === lastSignature && now - lastSentAt < 5000) return;
      lastSignature = signature;
      lastSentAt = now;
      sendClientError(payload);
    };

    console.error = (...args: unknown[]) => {
      originalConsoleError(...args);
      const message = args.map(serializeValue).join(" ");
      if (isIgnoredConsoleError(message)) return;
      const firstError = args.find((arg): arg is Error => arg instanceof Error);
      report(errorPayload("console.error", message, firstError?.stack));
    };

    const onError = (event: ErrorEvent) => {
      report(
        errorPayload(
          "window.error",
          windowErrorMessage(event),
          event.error instanceof Error ? event.error.stack : undefined,
        ),
      );
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      report(
        errorPayload(
          "unhandledrejection",
          serializeValue(event.reason),
          event.reason instanceof Error ? event.reason.stack : undefined,
        ),
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    return () => {
      console.error = originalConsoleError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
