// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import type { DrawingEntity, DrawingSave } from "~/lib/drawing-workspace";
import { useDrawingQueuedEdits } from "./useDrawingQueuedEdits";
const binding = vi.hoisted(() => ({ active: "org:worker" }));
vi.mock("~/lib/drawing-offline", () => ({
  isDrawingOfflineAccountActive: (key: string) => key === binding.active,
}));
const database = new IDBFactory();
const sheetId = "11111111-1111-4111-8111-111111111111";
const jobId = "22222222-2222-4222-8222-222222222222";
const draft = (): DrawingSave => ({
  sheetId,
  id: crypto.randomUUID(),
  expectedRevision: 0,
  visibility: "private",
  kind: "markup",
  data: {
    sourceSheetId: sheetId,
    type: "line",
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    stroke: "#ff0000",
    width: 2,
  },
});
function saved(input: DrawingSave): DrawingEntity {
  if (input.kind !== "markup") throw Error("fixture");
  return {
    id: input.id,
    sheetId,
    kind: "markup",
    data: input.data,
    authorId: "worker",
    authorName: "Worker",
    revision: input.expectedRevision + 1,
    visibility: input.visibility,
    comments: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
beforeEach(() => {
  vi.stubGlobal("indexedDB", database);
  binding.active = `${crypto.randomUUID()}:worker`;
});
afterEach(cleanup);
describe("drawing edit queue screen integration", () => {
  it("keeps a private offline drawing across remount and acknowledges it after reconnect", async () => {
    binding.active += ":simulation:session-id";
    const save = vi.fn(async (input: DrawingSave) => saved(input)),
      onSaved = vi.fn(),
      onError = vi.fn();
    const options = {
      accountKey: binding.active,
      userId: "worker",
      jobId,
      sheetId,
      save,
      onSaved,
      onError,
    };
    const first = renderHook(() =>
      useDrawingQueuedEdits({ ...options, online: false }),
    );
    await waitFor(() => expect(first.result.current.ready).toBe(true));
    const input = draft();
    await act(() => first.result.current.enqueue(input));
    expect(first.result.current.records[0]?.input.id).toBe(input.id);
    expect(save).not.toHaveBeenCalled();
    first.unmount();
    const second = renderHook(
      ({ online }) => useDrawingQueuedEdits({ ...options, online }),
      { initialProps: { online: false } },
    );
    await waitFor(() => expect(second.result.current.records).toHaveLength(1));
    second.rerender({ online: true });
    await waitFor(() => expect(second.result.current.records).toHaveLength(0));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toMatchObject({
      id: input.id,
      expectedRevision: 0,
      expectedUserId: "worker",
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: input.id, revision: 1 }),
    );
    expect(onError).not.toHaveBeenCalled();
  });
  it("retains a revision conflict without retrying or overwriting server data", async () => {
    const save = vi
      .fn<(input: DrawingSave) => Promise<DrawingEntity>>()
      .mockRejectedValue({
        data: { code: "CONFLICT" },
        message: "Another person changed this item",
      });
    const onSaved = vi.fn(),
      onError = vi.fn();
    const result = renderHook(() =>
      useDrawingQueuedEdits({
        accountKey: binding.active,
        userId: "worker",
        jobId,
        sheetId,
        online: true,
        save,
        onSaved,
        onError,
      }),
    );
    await waitFor(() => expect(result.result.current.ready).toBe(true));
    await act(() => result.result.current.enqueue(draft()));
    await waitFor(() =>
      expect(result.result.current.records[0]?.state).toBe("conflict"),
    );
    await act(() => result.result.current.sync());
    expect(save).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled();
    const record = result.result.current.records[0]!;
    await expect(
      result.result.current.retry(record.operationId),
    ).rejects.toThrow(/never overwritten/);
    expect(result.result.current.records[0]?.state).toBe("conflict");
  });
});
