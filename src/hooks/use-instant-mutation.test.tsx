import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useInstantMutation } from "./use-instant-mutation";

const notices = vi.hoisted(() => ({ notify: vi.fn() }));
vi.mock("~/components/ui/app-dialogs", () => notices);
const wrapper = ({ children }: { children: ReactNode }) =>
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const deferred = () => {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
afterEach(() => { vi.restoreAllMocks(); notices.notify.mockReset(); onlineManager.setOnline(true); });

describe("useInstantMutation", () => {
  it("shows the edit in the initiating call and sends once without waiting for the response", async () => {
    const server = deferred();
    const send = vi.fn(() => server.promise);
    const rollback = vi.fn(), finish = vi.fn(), commit = vi.fn();
    let shown = "before";
    const { result } = renderHook(() => useInstantMutation({
      mutationKey: ["fixture"], mutationFn: send,
      optimistic: (input: string) => { shown = input; return { rollback, finish, commit }; },
      errorMessage: "Could not save.",
    }), { wrapper });
    act(() => { result.current.mutate("after"); expect(shown).toBe("after"); });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(commit).not.toHaveBeenCalled();
    await act(async () => server.resolve("accepted"));
    await waitFor(() => expect(commit).toHaveBeenCalledWith("accepted"));
    expect(finish).toHaveBeenCalledOnce();
    expect(rollback).not.toHaveBeenCalled();
  });

  it("rolls back permission failure and gives one quiet notice without retrying", async () => {
    const rollback = vi.fn(), finish = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error("FORBIDDEN"));
    const { result } = renderHook(() => useInstantMutation({
      mutationKey: ["fixture"], mutationFn: send,
      optimistic: (_input: string) => ({ rollback, finish }), errorMessage: "Your change could not be saved.",
    }), { wrapper });
    act(() => result.current.mutate("after"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(rollback).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(notices.notify).toHaveBeenCalledExactlyOnceWith("Your change could not be saved.", "error");
  });

  it("rejects offline immediately and never sends on reconnect", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    onlineManager.setOnline(false);
    const optimistic = vi.fn((_input: string) => ({ rollback: vi.fn() }));
    const send = vi.fn().mockResolvedValue("saved");
    const { result } = renderHook(() => useInstantMutation({
      mutationKey: ["fixture"], mutationFn: send, optimistic, errorMessage: "Could not save.",
    }), { wrapper });
    act(() => result.current.mutate("after"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isPaused).toBe(false);
    expect(optimistic).not.toHaveBeenCalled();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    act(() => onlineManager.setOnline(true));
    expect(send).not.toHaveBeenCalled();
  });

  it("releases its edit when a connection drops between the click and send", async () => {
    const rollback = vi.fn(), finish = vi.fn(), send = vi.fn();
    const { result } = renderHook(() => useInstantMutation({
      mutationKey: ["fixture"], mutationFn: send,
      optimistic: (_input: string) => {
        vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
        return { rollback, finish };
      }, errorMessage: "Could not save.",
    }), { wrapper });
    act(() => result.current.mutate("after"));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(send).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });
});
