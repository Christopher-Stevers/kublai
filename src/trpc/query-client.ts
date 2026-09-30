import {
  defaultShouldDehydrateQuery,
  QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

export const createQueryClient = () =>
  new QueryClient({
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
