import { describe, expect, it } from "vitest";

import { planDetectedRoomReconciliation } from "~/server/rooms/reconcile-detected-rooms";

const shape = {
  type: "polygon" as const,
  points: [
    { x: 0.1, y: 0.1 },
    { x: 0.2, y: 0.1 },
    { x: 0.2, y: 0.2 },
  ],
};

describe("detected-room reconciliation", () => {
  it("updates matching auto rooms while preserving manual rooms", () => {
    const plan = planDetectedRoomReconciliation(
      [
        { id: "auto-kept", name: "N901", source: "auto" },
        { id: "auto-old", name: "Old trace", source: "auto" },
        { id: "manual", name: "Kitchen", source: "manual" },
      ],
      [
        { name: "N901", shape },
        { name: " kitchen ", shape },
        { name: "N902", shape },
      ],
    );

    expect(plan.updates.map((update) => update.id)).toEqual(["auto-kept"]);
    expect(plan.inserts.map((room) => room.name)).toEqual(["N902"]);
    expect(plan.obsoleteAutoIds).toEqual(["auto-old"]);
    expect(plan.obsoleteAutoIds).not.toContain("manual");
  });
});
