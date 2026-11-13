import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
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
  // The mocked mutation has not updated isPending: local intent still paints.
  expect(result.current.isPending).toBe(true);
  expect(result.current.cardProps(source)["aria-busy"]).toBe(true);
  expect(result.current.cardProps(target)["aria-busy"]).toBe(true);
  render(result.current.banner);
  expect(screen.getByRole("status")).toHaveTextContent("Merging…");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
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
    expect(animate).toHaveBeenNthCalledWith(1, expect.any(Array), expect.objectContaining({ duration: 150 }));
    expect(animate).toHaveBeenNthCalledWith(2, expect.any(Array), expect.objectContaining({ duration: 150 }));
    expect(document.body.textContent).not.toContain("Animated source");
  } finally {
    HTMLElement.prototype.animate = original;
    vi.unstubAllGlobals();
  }
});

it("reconciles an accepted merge immediately even when animation completion never arrives", () => {
  const animate = vi.fn(() => ({ finished: new Promise<void>(() => undefined) }));
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const original = HTMLElement.prototype.animate;
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const onMerged = vi.fn();
    const { result, unmount } = renderHook(() => useCardMerge({ disabled: false, onMerged }));
    const from = document.createElement("div");
    from.textContent = "Still flying";
    result.current.cardProps(source).ref(from);
    result.current.cardProps(target).ref(document.createElement("div"));
    act(() => result.current.begin(source));
    act(() => result.current.pick(target));
    expect(mocks.sync).not.toHaveBeenCalled();
    act(() => mocks.options.onSuccess({ id: target.id, movedCount: 1, sourceDeleted: false }));
    expect(onMerged).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining("Locked items remain"), "success");
    expect(result.current.active).toBe(false);
    expect(result.current.isPending).toBe(false);
    expect(document.body.textContent).toContain("Still flying");
    unmount();
    expect(document.body.textContent).not.toContain("Still flying");
  } finally {
    HTMLElement.prototype.animate = original;
    vi.unstubAllGlobals();
  }
});

it.each(["reduced motion", "unavailable animation", "cancelled animation"])("keeps accepted state when there is %s", async mode => {
  vi.stubGlobal("matchMedia", () => ({ matches: mode === "reduced motion" }));
  const original = HTMLElement.prototype.animate;
  const animate = vi.fn(() => {
    if (mode === "unavailable animation") throw new Error("Unavailable");
    return { finished: Promise.reject(new Error("Cancelled")) };
  });
  HTMLElement.prototype.animate = animate as unknown as typeof original;
  try {
    const onMerged = vi.fn();
    const { result } = renderHook(() => useCardMerge({ disabled: false, onMerged }));
    const from = document.createElement("div");
    from.textContent = "Temporary merge card";
    result.current.cardProps(source).ref(from);
    result.current.cardProps(target).ref(document.createElement("div"));
    act(() => result.current.begin(source));
    act(() => result.current.pick(target));
    await act(() => mocks.options.onSuccess({ id: target.id, movedCount: 1, sourceDeleted: true }));
    expect(onMerged).toHaveBeenCalledOnce();
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(result.current.active).toBe(false);
    expect(mocks.notify).toHaveBeenCalledWith(expect.stringContaining("Empty source list removed"), "success");
    expect(document.body.textContent).not.toContain("Temporary merge card");
    if (mode === "reduced motion") expect(animate).not.toHaveBeenCalled();
  } finally {
    HTMLElement.prototype.animate = original;
    vi.unstubAllGlobals();
  }
});

it("reconciles a late accepted merge without reviving a removed view or animation", () => {
  const onMerged = vi.fn();
  const { result, unmount } = renderHook(() => useCardMerge({ disabled: false, onMerged }));
  const from = document.createElement("div");
  from.textContent = "Removed merge view";
  result.current.cardProps(source).ref(from);
  result.current.cardProps(target).ref(document.createElement("div"));
  act(() => result.current.begin(source));
  act(() => result.current.pick(target));
  unmount();
  act(() => mocks.options.onSuccess({ id: target.id, movedCount: 1, sourceDeleted: true }));
  expect(mocks.sync).toHaveBeenCalledOnce();
  expect(onMerged).not.toHaveBeenCalled();
  expect(mocks.notify).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain("Removed merge view");
});
