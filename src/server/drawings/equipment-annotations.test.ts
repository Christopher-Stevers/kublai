// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const index = vi.hoisted(() => vi.fn());
vi.mock("./equipment-index", () => ({
  equipmentIndex: index,
  drawingPdfLocation: () => ({ file: "test.pdf", page: 1 }),
}));
import {
  equipmentAnnotationPlan,
  withoutTagHighlight,
} from "./equipment-annotations";
import { equipmentDrawingDestination } from "~/lib/equipment-tags";
import { readSnapshotState } from "~/lib/snapshot-source";
import type { DrawingEntity, DrawingJobSheet } from "~/lib/drawing-workspace";
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const box = { text: "HEX-2", left: 0.2, right: 0.25, top: 0.3, bottom: 0.32 };
const sheets = [1, 2, 3].map((n) => ({
  id: id(n),
  setId: id(n === 3 ? 31 : 30),
  name: `M-${n}`,
  imageUrl: "test",
})) as DrawingJobSheet[];
const link = equipmentDrawingDestination({
  jobId: id(10),
  setId: id(30),
  sheetId: id(2),
  sourceSheetId: id(2),
  name: "M-2",
  tag: "HEX-2",
  box,
});
const entity = {
  id: id(20),
  sheetId: id(1),
  kind: "markup",
  visibility: "private",
  data: {
    type: "link",
    equipmentTag: "HEX-2",
    sourceSheetId: id(1),
    points: [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
    ],
    links: [
      { label: "M-2", url: link.href },
      { label: "Manual", url: "/dashboard/jobs" },
    ],
  },
} as DrawingEntity;
beforeEach(() =>
  index.mockResolvedValue({
    pages: [
      {
        page: 1,
        words: [
          box,
          { ...box, left: 0.6, right: 0.65 },
          { ...box, text: "HEX-20" },
        ],
      },
    ],
  }),
);
it("creates a clickable annotation per exact occurrence, with shared links and a return link", async () => {
  const plan = await equipmentAnnotationPlan(
    entity,
    id(10),
    sheets,
    async (s) => s,
  );
  expect(plan).toHaveLength(2);
  expect(plan[0]?.links).toHaveLength(3);
  expect(plan[0]?.points).toEqual([
    { x: 0.2, y: 0.3 },
    { x: 0.25, y: 0.32 },
  ]);
  expect(plan[0]?.id).not.toBe(plan[1]?.id);
  expect(
    await equipmentAnnotationPlan(entity, id(10), sheets, async (s) => s),
  ).toEqual(plan);
  expect(
    readSnapshotState(new URL(plan[0]!.links[0]!.url!, "https://test").hash)
      ?.drawing?.sheetId,
  ).toBe(id(1));
});
it("does not propagate generated copies, archives, or unrelated pages", async () => {
  for (const changed of [
    { ...entity, visibility: "archived" },
    { ...entity, data: { ...entity.data, equipmentOriginId: id(40) } },
  ])
    expect(
      await equipmentAnnotationPlan(
        changed as DrawingEntity,
        id(10),
        sheets,
        async (s) => s,
      ),
    ).toEqual([]);
  expect(
    await equipmentAnnotationPlan(
      entity,
      id(10),
      sheets.map((s) => ({ ...s, setId: s.id })),
      async (s) => s,
    ),
  ).toEqual([]);
});
it("fails saving if indexing or target access fails, rather than silently leaving missing tags", async () => {
  await expect(
    equipmentAnnotationPlan(entity, id(10), sheets, async () => {
      throw Error("forbidden");
    }),
  ).rejects.toThrow("forbidden");
  index.mockRejectedValueOnce(Error("index unavailable"));
  await expect(
    equipmentAnnotationPlan(entity, id(10), sheets, async (s) => s),
  ).rejects.toThrow("index unavailable");
});
it("removes old search highlights while retaining the destination viewport", () => {
  const url = new URL(link.href, "https://test");
  const state = readSnapshotState(url.hash)!;
  state.drawing!.highlight = box;
  state.drawing!.search = "HEX-2";
  url.hash = `snapshot=${encodeURIComponent(JSON.stringify(state))}`;
  const cleaned = withoutTagHighlight({
    label: "tag",
    url: url.pathname + url.search + url.hash,
  });
  const drawing = readSnapshotState(
    new URL(cleaned.url!, "https://test").hash,
  )?.drawing;
  expect(drawing?.highlight).toBeUndefined();
  expect(drawing?.search).toBe("");
  expect(drawing?.viewport).toEqual(state.drawing!.viewport);
});
