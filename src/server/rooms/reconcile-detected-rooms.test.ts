import { describe, expect, it } from "vitest";

import { planDetectedRoomReconciliation } from "~/server/rooms/reconcile-detected-rooms";

const box = (x: number, y: number, size = 0.1) => ({
  type: "polygon" as const,
  points: [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ],
});

describe("detected-room reconciliation", () => {
  it("updates auto rooms in the same place, keeps manual rooms, drops stale traces", () => {
    const plan = planDetectedRoomReconciliation(
      [
        { id: "auto-kept", name: "N901", source: "auto", shape: box(0, 0) },
        { id: "auto-old", name: "Old trace", source: "auto", shape: box(0.5, 0.5) },
        { id: "manual", name: "Kitchen", source: "manual", shape: box(0.2, 0) },
      ],
      [
        { name: "N901", shape: box(0.01, 0) },
        { name: "Kitchen", shape: box(0.2, 0) },
        { name: "N902", shape: box(0.4, 0) },
      ],
    );

    expect(plan.updates.map((update) => update.id)).toEqual(["auto-kept"]);
    expect(plan.inserts.map((room) => room.name)).toEqual(["N902"]);
    expect(plan.obsoleteAutoIds).toEqual(["auto-old"]);
  });

  it("keeps every unit that shares a type name", () => {
    const plan = planDetectedRoomReconciliation(
      [],
      [
        { name: "2 BEDROOM", shape: box(0, 0) },
        { name: "2 BEDROOM", shape: box(0.2, 0) },
        { name: "2 bedroom", shape: box(0.4, 0) },
        { name: "ELEC. CLOSET", shape: box(0, 0.2) },
        { name: "ELEC. CLOSET", shape: box(0.2, 0.2) },
      ],
      { preserveExisting: true },
    );

    expect(plan.inserts).toHaveLength(5);
  });

  it("keeps neighbours that only touch along a shared wall", () => {
    const plan = planDetectedRoomReconciliation(
      [{ id: "saved", name: "N201", source: "auto", shape: box(0, 0) }],
      // Traced 5% into N201's outline, as happens along a shared wall.
      [{ name: "N202", shape: box(0.095, 0) }],
      { preserveExisting: true },
    );

    expect(plan.inserts.map((room) => room.name)).toEqual(["N202"]);
  });

  it("does not re-add a room already saved in the same place under another name", () => {
    const plan = planDetectedRoomReconciliation(
      [{ id: "manual", name: "Suite 4", source: "manual", shape: box(0, 0) }],
      [
        { name: "2 BEDROOM", shape: box(0.005, 0.005) },
        { name: "2 BEDROOM", shape: box(0.3, 0) },
        { name: "2 BEDROOM", shape: box(0.305, 0) },
      ],
      { preserveExisting: true },
    );

    expect(plan.inserts).toEqual([{ name: "2 BEDROOM", shape: box(0.3, 0) }]);
    expect(plan.updates).toEqual([]);
  });
});
