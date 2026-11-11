import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useInstantReceiptVerification, type ReceiptSnapshot } from "./use-instant-receipt-verification";
import { useTableReceive } from "~/components/materialLists/TableReceive";

const server = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn(), pull: vi.fn(), notify: vi.fn() }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: server.notify }));
vi.mock("~/lib/replicache-material-list", () => ({ requestMaterialListReplicacheSync: server.pull }));
vi.mock("~/trpc/react", () => ({ api: { useUtils: () => ({
  client: { materialList: { updateOrderItemVerification: { mutate: server.save } } },
  materialList: Object.fromEntries(["getOrderById", "getOrdersForMaterialList", "listOrders"].map(key => [key, { invalidate: server.invalidate }])),
}) } }));
const saved: ReceiptSnapshot[] = [{ orderItemId: "line", receivedQuantity: "2", verificationStatus: "partial" }];
const change = { orderItemId: "line", receivedQuantity: 10, verificationStatus: "complete" as const };
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const deferred = () => {
  let resolve!: (value: typeof change) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<typeof change>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); onlineManager.setOnline(true); });

it("holds the visible accepted receipt until sync catches up, without altering saved rows", async () => {
  const request = deferred(); server.save.mockReturnValue(request.promise);
  const { result, rerender } = renderHook(({ rows }) => useInstantReceiptVerification(rows), { initialProps: { rows: saved }, wrapper });
  act(() => result.current.mutate(change));
  expect(result.current.previews.line).toMatchObject({ receivedQuantity: 10, saving: true });
  expect(saved[0]?.receivedQuantity).toBe("2");
  await act(async () => request.resolve(change));
  await waitFor(() => expect(result.current.previews.line?.saving).toBe(false));
  expect(server.pull).toHaveBeenCalledWith(0, "pull");
  rerender({ rows: [{ ...saved[0]!, receivedQuantity: "10", verificationStatus: "complete" }] });
  await waitFor(() => expect(result.current.previews.line).toBeUndefined());
});

it("restores a refused receipt and resets controls even when the saved value is unchanged", async () => {
  server.save.mockRejectedValue(new Error("FORBIDDEN"));
  const { result } = renderHook(() => useInstantReceiptVerification(saved), { wrapper });
  act(() => result.current.mutate(change));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.previews.line).toBeUndefined();
  expect(result.current.resetVersions.line).toBe(1);
  expect(server.save).toHaveBeenCalledOnce();
  expect(server.pull).not.toHaveBeenCalled();
});

it("restores the prior accepted receipt when a second edit fails before sync arrives", async () => {
  server.save.mockResolvedValueOnce(change).mockRejectedValueOnce(new Error("refused"));
  const { result } = renderHook(() => useInstantReceiptVerification(saved), { wrapper });
  await act(async () => { await result.current.mutateAsync(change); });
  act(() => result.current.mutate({ ...change, receivedQuantity: 4, verificationStatus: "partial" }));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.previews.line).toMatchObject({ receivedQuantity: 10, saving: false });
});

it("uses the selected order snapshot when duplicate sources disagree, then yields to a new saved receipt", async () => {
  server.save.mockResolvedValue(change);
  const { result, rerender } = renderHook(({ rows }) => useInstantReceiptVerification(rows), { initialProps: { rows: saved }, wrapper });
  await act(async () => { await result.current.mutateAsync(change); });
  rerender({ rows: [{ ...saved[0]!, receivedQuantity: "6" }, ...saved] });
  await act(async () => { await Promise.resolve(); });
  expect(result.current.previews.line?.receivedQuantity).toBe(10);
  rerender({ rows: [{ ...saved[0]!, receivedQuantity: "6" }] });
  await waitFor(() => expect(result.current.previews.line).toBeUndefined());
});

it("refuses another edit to a pending line while another line remains editable", async () => {
  const request = deferred(); server.save.mockReturnValue(request.promise);
  const { result } = renderHook(() => useInstantReceiptVerification(saved), { wrapper });
  act(() => {
    result.current.mutate(change);
    result.current.mutate({ ...change, receivedQuantity: 4 });
    result.current.mutate({ ...change, orderItemId: "second" });
  });
  await waitFor(() => expect(server.save).toHaveBeenCalledTimes(2));
  expect(result.current.previews.line?.receivedQuantity).toBe(10);
  expect(result.current.previews.second?.saving).toBe(true);
  await act(async () => request.resolve(change));
  await waitFor(() => expect(result.current.isPending).toBe(false));
});

it("does not overwrite a newer saved receipt with a delayed response", async () => {
  const request = deferred(); server.save.mockReturnValue(request.promise);
  const { result, rerender } = renderHook(({ rows }) => useInstantReceiptVerification(rows), { initialProps: { rows: saved }, wrapper });
  act(() => result.current.mutate(change));
  rerender({ rows: [{ ...saved[0]!, receivedQuantity: "6" }] });
  await act(async () => request.resolve(change));
  await waitFor(() => expect(result.current.previews.line).toBeUndefined());
});

it("resets a control edited just before an offline refusal and never replays it", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  onlineManager.setOnline(false);
  const { result } = renderHook(() => {
    const mutation = useInstantReceiptVerification(saved);
    const preview = mutation.previews.line;
    const control = useTableReceive({ ordered: 10, received: preview?.receivedQuantity ?? 2,
      status: preview?.verificationStatus ?? "partial", resetVersion: mutation.resetVersions.line,
      onChange: input => mutation.mutate({ orderItemId: "line", ...input }),
    });
    return { mutation, control };
  }, { wrapper });
  act(() => result.current.control.toggleAll());
  await waitFor(() => expect(result.current.mutation.isError).toBe(true));
  expect(result.current.control.received).toBe(2);
  expect(server.save).not.toHaveBeenCalled();
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  act(() => onlineManager.setOnline(true));
  expect(server.save).not.toHaveBeenCalled();
});

it("treats a vanished order line as a refusal, not a successful receipt", async () => {
  server.save.mockResolvedValue(undefined);
  const { result } = renderHook(() => useInstantReceiptVerification(saved), { wrapper });
  act(() => result.current.mutate(change));
  await waitFor(() => expect(result.current.isError).toBe(true));
  expect(result.current.previews.line).toBeUndefined();
  expect(server.pull).not.toHaveBeenCalled();
});

it("keeps bulk excluded across table debounce and the deferred individual receipt request", async () => {
  vi.useFakeTimers();
  const { createReceiptIntentGate } = await import("~/lib/receipt-intent-gate");
  const gate = createReceiptIntentGate(), request = deferred();
  server.save.mockReturnValue(request.promise);
  const hook = renderHook(() => {
    const mutation = useInstantReceiptVerification(saved);
    const control = useTableReceive({ ordered: 10, received: 2, status: "partial",
      onPendingChange: active => gate.change("line", active),
      onChange: input => queueMicrotask(() => mutation.mutate({ orderItemId: "line", ...input })),
    });
    return { mutation, control };
  }, { wrapper });
  act(() => hook.result.current.control.step(1));
  expect(gate.tryStartBulk(hook.result.current.mutation.hasPending())).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(server.save).toHaveBeenCalledExactlyOnceWith({ orderItemId: "line", receivedQuantity: 3, verificationStatus: "partial" });
  expect(gate.hasQueued()).toBe(false);
  expect(gate.tryStartBulk(hook.result.current.mutation.hasPending())).toBe(false);
  await act(async () => { request.resolve(change); await request.promise; });
  expect(hook.result.current.mutation.hasPending()).toBe(false);
  expect(gate.tryStartBulk(false)).toBe(true);
  vi.useRealTimers();
});
