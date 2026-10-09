import {
  defaultShouldDehydrateQuery,
  MutationCache,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

export const createQueryClient = () => {
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        const path = mutation.options.mutationKey?.[0];
        const router: unknown = Array.isArray(path) ? path[0] : null;
        if (
          router === "chat" ||
          router === "conversations" ||
          router === "drawingsWorkspace"
        ) {
          // Reading a chat or drawing elsewhere should update the bell at once.
          void client.invalidateQueries({ queryKey: [["notifications"]] });
        }
      },
    }),
    defaultOptions: {
      queries: {
        // With SSR, we usually want to set some default staleTime
        // above 0 to avoid refetching immediately on the client
        staleTime: 30 * 1000,
        retry: (count, error) => {
          const status = (error as { data?: { httpStatus?: number } }).data
            ?.httpStatus;
          return (
            count < 2 &&
            (!status || status === 408 || status === 429 || status >= 500)
          );
        },
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        refetchOnReconnect: true,
      },
      mutations: { retry: false },
      dehydrate: {
        serializeData: SuperJSON.serialize,
        shouldDehydrateQuery: (query) =>
          defaultShouldDehydrateQuery(query) ||
          query.state.status === "pending",
      },
      hydrate: {
        deserializeData: SuperJSON.deserialize,
      },
    },
  });
  return client;
};
