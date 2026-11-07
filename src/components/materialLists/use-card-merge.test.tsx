import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ mutate: vi.fn(), sync: vi.fn(), notify: vi.fn(), options: {} as any }));
vi.mock("~/trpc/react", () => ({ api: { materialList: { merge: { useMutation: (options: unknown) => {
  mocks.options = options;
  return { mutate: mocks.mutate, isPending: false };
} } } } }));
vi.mock("~/lib/replicache-material-list", () => ({ requestMaterialListReplicacheSync: mocks.sync }));
vi.mock("~/components/ui/app-dialogs", () => ({ notify: mocks.notify }));
import { useCardMerge } from "./use-card-merge";
const source = { id: "source", name: "Source" };
const target = { id: "target", name: "Target" };
beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);
it("selects a destination card, ignores source/tool cards and prevents duplicate submissions", () => {
  const { result } = renderHook(() => useCardMerge({ disabled: false, onMerged: vi.fn() }));
  act(() => result.current.begin(source));
  act(() => { result.current.pick(source); result.current.pick({ ...target, kind: "tools" }); });
  expect(mocks.mutate).not.toHaveBeenCalled();
  act(() => { result.current.pick(target); result.current.pick(target); });
  expect(mocks.mutate).toHaveBeenCalledExactlyOnceWith({ sourceId: "source", targetId: "target" });
});
it("keeps selection after a failed request and permits retry, then exits on success", async () => {
  const onMerged = vi.fn();
  const { result } = renderHook(() => useCardMerge({ disabled: false, onMerged }));
  act(() => result.current.begin(source));
  act(() => result.current.pick(target));
  act(() => mocks.options.onError(new Error("Disconnected")));
  expect(result.current.active).toBe(true);
  expect(mocks.sync).not.toHaveBeenCalled();
  act(() => result.current.pick(target));
  await act(() => mocks.options.onSuccess({ id: target.id, movedCount: 2, sourceDeleted: true }));
  expect(result.current.active).toBe(false);
  expect(onMerged).toHaveBeenCalledOnce();
  expect(mocks.sync).toHaveBeenCalledOnce();
});
it("does not merge while offline or awaiting local sync and Escape cancels selection", () => {
  const { result } = renderHook(() => useCardMerge({ disabled: true, onMerged: vi.fn() }));
  act(() => result.current.begin(source));
  act(() => result.current.pick(target));
  expect(mocks.mutate).not.toHaveBeenCalled();
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(result.current.active).toBe(false);
});
it("animates the source into the destination only after success and cleans up the temporary card", async () => {
  const animate = vi.fn(() => ({ finished: Promise.resolve() }));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const original = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate as any;
  try {
    const { result } = renderHook(() => useCardMerge({ disabled: false, onMerged: vi.fn() }));
    const from = document.createElement("div");
    from.textContent = "Animated source";
    result.current.cardProps(source).ref(from);
    result.current.cardProps(target).ref(document.createElement("div"));
    act(() => result.current.begin(source));
    act(() => result.current.pick(target));
    expect(animate).not.toHaveBeenCalled();
    await act(() => mocks.options.onSuccess({ id: target.id, movedCount: 1, sourceDeleted: true }));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).not.toContain("Animated source");
  } finally {
    HTMLElement.prototype.animate = original;
    vi.unstubAllGlobals();
  }
});
