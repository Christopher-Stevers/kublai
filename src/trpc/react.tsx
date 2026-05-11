"use client";

import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { httpBatchStreamLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import { type inferRouterInputs, type inferRouterOutputs } from "@trpc/server";
import { useEffect, useState } from "react";
import SuperJSON from "superjson";

import { type AppRouter } from "~/server/api/root";
import { TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER } from "~/lib/server-connection-mode";
import { createQueryClient } from "./query-client";

function blockedServerFetch(input: RequestInfo | URL, init?: RequestInit) {
  if (TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER && typeof window !== "undefined") {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const url = new URL(rawUrl, window.location.origin);

    if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
      return Promise.reject(
        new Error(`Temporary local-first test mode blocked server API call: ${url.pathname}`),
      );
    }
  }

  return globalThis.fetch(input, init);
}

let clientQueryClientSingleton: QueryClient | undefined = undefined;
const getQueryClient = () => {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return createQueryClient();
  }
  // Browser: use singleton pattern to keep the same query client
  clientQueryClientSingleton ??= createQueryClient();

  return clientQueryClientSingleton;
};

export const api = createTRPCReact<AppRouter>();

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

export function TRPCReactProvider(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  useEffect(() => {
    if (!TEMPORARILY_DISCONNECT_BROWSER_FROM_SERVER) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const url = new URL(rawUrl, window.location.origin);

      if (url.origin === window.location.origin && url.pathname.startsWith("/api/")) {
        return Promise.reject(
          new Error(`Temporary local-first test mode blocked server API call: ${url.pathname}`),
        );
      }

      return originalFetch(input, init);
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const [trpcClient] = useState(() =>
    api.createClient({
      links: [
        loggerLink({
          enabled: (op) => {
            const path = "path" in op ? op.path : undefined;
            const isOfflinePullFetchFailure =
              op.direction === "down" &&
              path === "materialList.pullMaterialListSyncChanges" &&
              op.result instanceof Error &&
              op.result.message === "Failed to fetch";

            if (isOfflinePullFetchFailure) return false;

            return (
              process.env.NODE_ENV === "development" ||
              (op.direction === "down" && op.result instanceof Error)
            );
          },
        }),
        httpBatchStreamLink({
          transformer: SuperJSON,
          url: getBaseUrl() + "/api/trpc",
          fetch: blockedServerFetch,
          headers: () => {
            const headers = new Headers();
            headers.set("x-trpc-source", "nextjs-react");
            return headers;
          },
        }),
      ],
    }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <api.Provider client={trpcClient} queryClient={queryClient}>
        {props.children}
      </api.Provider>
    </QueryClientProvider>
  );
}

function getBaseUrl() {
  if (typeof window !== "undefined") return window.location.origin;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return `http://localhost:${process.env.PORT ?? 3000}`;
}
