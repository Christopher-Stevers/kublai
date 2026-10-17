import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
  changes: vi.fn(),
  full: vi.fn(),
  cached: undefined as unknown,
}));
vi.mock("@trpc/react-query", () => ({
  getQueryKey: (_: unknown, input: unknown) => ["drawing", input],
}));
vi.mock("~/trpc/react", () => ({
  api: {
    drawingsWorkspace: { get: {} },
    useUtils: () => ({
      drawingsWorkspace: { get: { getData: () => mocks.cached } },
      client: {
        drawingsWorkspace: {
          changes: { query: mocks.changes },
          get: { query: mocks.full },
        },
      },
    }),
  },
}));
import { useDrawingWorkspaceQuery } from "./use-drawing-workspace-query";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.cached = undefined;
});
it("retains cached annotations on unchanged polls, applies changes and propagates revoked access", async () => {
  const before = {
    revision: "a",
    sheetId: "sheet",
    entities: [{ id: "mark" }],
  };
  const after = { ...before, revision: "b", entities: [] };
  mocks.cached = before;
  mocks.changes.mockResolvedValue({ revision: "a", workspace: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useDrawingWorkspaceQuery("sheet", true), {
    wrapper,
  });
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
  expect(result.current.data).toEqual(before);
  expect(mocks.full).not.toHaveBeenCalled();
  expect(mocks.changes).toHaveBeenCalledWith(
    { sheetId: "sheet", revision: "a" },
    expect.objectContaining({ signal: expect.anything() as AbortSignal }),
  );
  mocks.changes.mockResolvedValue({ revision: "b", workspace: after });
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() => expect(result.current.data).toEqual(after));
  mocks.changes.mockRejectedValue(
    Object.assign(Error("Permission changed"), { data: { code: "FORBIDDEN" } }),
  );
  await act(async () => {
    await result.current.refetch();
  });
  await waitFor(() =>
    expect(result.current.error).toMatchObject({ data: { code: "FORBIDDEN" } }),
  );
  client.clear();
});
