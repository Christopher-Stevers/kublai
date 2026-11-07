import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { type NextRequest } from "next/server";

import { env } from "~/env";
import { appRouter } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a HTTP request (e.g. when you make requests from Client Components).
 */
const createContext = async (req: NextRequest) => {
  const start = Date.now();
  const context = await createTRPCContext({
    headers: req.headers,
  });
  // Sign-in checks run before the timed procedures; show them for drawings.
  if (req.nextUrl.pathname.includes("drawingsWorkspace."))
    console.log(`[TRPC] sign-in check took ${Date.now() - start}ms`);
  return context;
};

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createContext(req),
    onError:
      env.NODE_ENV === "development"
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? "<no-path>"}: ${error.message}`,
            );
          }
        : undefined,
  });

export const maxDuration = 180;

export { handler as GET, handler as POST };
