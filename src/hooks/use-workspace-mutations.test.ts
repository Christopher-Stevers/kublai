import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { useWorkspaceMutations } from "./use-workspace-mutations";

const mocks = vi.hoisted(() => ({
  sandbox: null as TutorialSandbox | null,
  liveGet: vi.fn(),
  liveMutate: vi.fn(),
  liveSync: vi.fn(),
  liveQuantity: vi.fn(),
}));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => mocks.sandbox,
}));
vi.mock("~/lib/replicache-material-list", () => ({
  getMaterialListReplicache: mocks.liveGet,
  mutateMaterialListAndSync: mocks.liveMutate,
  requestMaterialListReplicacheSync: mocks.liveSync,
  saveQuantityDurably: mocks.liveQuantity,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sandbox = null;
});
afterEach(cleanup);

describe("workspace mutation isolation", () => {
  it("uses only the tutorial database and never schedules live sync or quantity journal writes", async () => {
    const updateItemQuantity = vi.fn().mockResolvedValue(undefined);
    const material = {
      mutate: { updateItemQuantity },
    } as unknown as TutorialSandbox["material"];
    mocks.sandbox = {
      material,
      catalogue: {} as TutorialSandbox["catalogue"],
      userId: "demo",
      runId: "demo-run",
    };
    const { result } = renderHook(useWorkspaceMutations);
    expect(result.current.getReplicache()).toBe(material);
    await expect(
      result.current.mutateAndSync(Promise.resolve("saved")),
    ).resolves.toBe("saved");
    const input = {
      itemId: "demo-item",
      materialListId: "demo-list",
      quantity: 5,
    };
    await result.current.saveQuantity(input);
    result.current.requestSync();
    expect(updateItemQuantity).toHaveBeenCalledExactlyOnceWith(input);
    expect(mocks.liveGet).not.toHaveBeenCalled();
    expect(mocks.liveMutate).not.toHaveBeenCalled();
    expect(mocks.liveSync).not.toHaveBeenCalled();
    expect(mocks.liveQuantity).not.toHaveBeenCalled();
  });

  it("preserves normal persistence and sync outside the tutorial", async () => {
    const live = { id: "real" };
    mocks.liveGet.mockReturnValue(live);
    mocks.liveMutate.mockImplementation((promise: Promise<unknown>) => promise);
    mocks.liveQuantity.mockResolvedValue(undefined);
    const { result } = renderHook(useWorkspaceMutations);
    expect(mocks.liveGet).not.toHaveBeenCalled();
    expect(result.current.getReplicache()).toBe(live);
    const pending = Promise.resolve("real-saved");
    await expect(result.current.mutateAndSync(pending)).resolves.toBe(
      "real-saved",
    );
    expect(mocks.liveMutate).toHaveBeenCalledExactlyOnceWith(pending);
    const input = {
      itemId: "real-item",
      materialListId: "real-list",
      quantity: 6,
    };
    await result.current.saveQuantity(input);
    result.current.requestSync(250, "pull");
    expect(mocks.liveQuantity).toHaveBeenCalledExactlyOnceWith(input);
    expect(mocks.liveSync).toHaveBeenCalledExactlyOnceWith(250, "pull");
  });

  it("propagates demo write failures without falling through to live persistence", async () => {
    mocks.sandbox = {
      material: {} as TutorialSandbox["material"],
      catalogue: {} as TutorialSandbox["catalogue"],
      userId: "demo",
      runId: "run",
    };
    const { result } = renderHook(useWorkspaceMutations);
    await expect(
      result.current.mutateAndSync(
        Promise.reject(new Error("demo write failed")),
      ),
    ).rejects.toThrow("demo write failed");
    expect(mocks.liveMutate).not.toHaveBeenCalled();
    expect(mocks.liveSync).not.toHaveBeenCalled();
  });
});
