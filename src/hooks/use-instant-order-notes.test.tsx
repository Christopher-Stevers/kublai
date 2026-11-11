import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useInstantOrderNotes } from "./use-instant-order-notes";

const state = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn(), notify: vi.fn() }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: state.notify }));
vi.mock("@trpc/react-query", () => ({ getQueryKey: (_route: unknown, input: { orderId: string }) => ["order", input.orderId] }));
vi.mock("~/trpc/react", () => ({ api: {
  materialList: { getOrderById: {} },
  useUtils: () => ({
    client: { materialList: { updateOrderNotes: { mutate: state.save } } },
    materialList: { getOrderById: { invalidate: state.invalidate } },
  }),
} }));
afterEach(() => vi.clearAllMocks());

it("shows normalized notes before the request and returns the previous notes on failure", async () => {
  const client = new QueryClient();
  client.setQueryData(["order", "fixture"], { id: "fixture", notes: "previous", unrelated: true });
  state.save.mockRejectedValue(new Error("permission changed"));
  const onStart = vi.fn(), onError = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result } = renderHook(() => useInstantOrderNotes({ onStart, onError }), { wrapper });
  act(() => {
    result.current.mutate({ orderId: "fixture", notes: "  next  " });
    expect(client.getQueryData(["order", "fixture"])).toEqual({ id: "fixture", notes: "next", unrelated: true });
    expect(onStart).toHaveBeenCalledOnce();
  });
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(client.getQueryData(["order", "fixture"])).toEqual({ id: "fixture", notes: "previous", unrelated: true });
  expect(onError).toHaveBeenCalledWith({ orderId: "fixture", notes: "  next  " });
});
