import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AutomaticDiagnostics } from "./AutomaticDiagnostics";
vi.mock("~/components/jobs/DrawingAccountProvider", () => ({
  useDrawingAccount: () => ({ accountKey: "org:user" }),
}));
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("sends categories only, deduplicates errors and honors immediate opt-out", async () => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AutomaticDiagnostics />
    </QueryClientProvider>,
  );
  const fail = async () => {
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: [["rooms", "save"]],
        mutationFn: async () => {
          throw Object.assign(new Error("private room name"), {
            data: { httpStatus: 500 },
          });
        },
      })
      .execute({ private: "drawing contents" })
      .catch(() => undefined);
  };
  await act(fail);
  expect(fetch).toHaveBeenCalledTimes(1);
  const body = JSON.parse(
    vi.mocked(fetch).mock.calls[0]![1]!.body as string,
  ) as Record<string, unknown>;
  expect(body).toMatchObject({
    kind: "action_failed",
    feature: "rooms",
    code: "server",
  });
  expect(JSON.stringify(body)).not.toContain("private");
  await act(fail);
  expect(fetch).toHaveBeenCalledTimes(1);
  values.set("foremanhq:diagnostics:org:user", "off");
  await act(async () => {
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: [["documents", "save"]],
        mutationFn: async () => {
          throw Error("secret");
        },
      })
      .execute(undefined)
      .catch(() => undefined);
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  client.clear();
});
