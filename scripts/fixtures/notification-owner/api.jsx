// Explicit synthetic HTTP transport seam; no tRPC server/authentication claim.
import {
  useQueryClient,
  useInfiniteQuery,
  useMutation,
} from "@tanstack/react-query";
const rpc = async (name, input, options = {}) => {
  const response = await fetch(`/fixture/${name}`, { signal: options.signal });
  if (!response.ok) throw new Error(`Synthetic HTTP ${response.status}`);
  return response.json();
};
const client = {
  notifications: {
    identity: { query: (input, options) => rpc("identity", input, options) },
    overview: { query: (input, options) => rpc("overview", input, options) },
  },
};
const invalidate = async () => undefined;
export const api = {
  useUtils() {
    useQueryClient();
    return {
      client,
      notifications: { overview: { invalidate }, list: { invalidate } },
      drawingsWorkspace: { notifications: { invalidate } },
      chat: { getOverview: { invalidate } },
      conversations: { list: { invalidate } },
    };
  },
  notifications: {
    identity: { _def: () => ({ path: ["notifications", "identity"] }) },
    overview: { _def: () => ({ path: ["notifications", "overview"] }) },
    list: {
      useInfiniteQuery: (input, options) =>
        useInfiniteQuery({
          queryKey: [["notifications", "list"], { input, type: "infinite" }],
          queryFn: ({ signal }) => rpc("list", input, { signal }),
          initialPageParam: null,
          ...options,
        }),
    },
    read: {
      useMutation: () =>
        useMutation({
          mutationFn: async () => {
            throw new Error("Writes prohibited in component fixture");
          },
        }),
    },
  },
};
