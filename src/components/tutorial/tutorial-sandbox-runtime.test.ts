import { afterEach, describe, expect, it, vi } from "vitest";
// The app tRPC client has a legacy inline type import retained by Vitest.
vi.mock("~/server/api/root", () => ({}));
import { api } from "~/trpc/react";
import { sandboxLink } from "./TutorialSandboxProvider";
import { createTutorialSandbox, type SandboxRuntime } from "./tutorial-sandbox-runtime";
import { DEMO_JOB_ID, DEMO_ROOM_ID, DEMO_PART_ID } from "./tutorial-sandbox-fixtures";

const runtimes: SandboxRuntime[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()));
  vi.unstubAllGlobals();
});
async function start(userId = "practice-user") {
  const runtime = await createTutorialSandbox(userId);
  runtimes.push(runtime);
  return runtime;
}
const newId = () => crypto.randomUUID();

describe("isolated real-workflow tutorial runtime", () => {
  it("seeds real Replicache readers without HTTP or persistent browser storage", async () => {
    const fetch = vi.fn(() => { throw new Error("Network must not be used"); });
    vi.stubGlobal("fetch", fetch);
    const runtime = await start();
    expect(await runtime.material.query(tx => tx.get(`job/${DEMO_JOB_ID}`))).toMatchObject({ name: "Riverside Community Centre" });
    expect(await runtime.catalogue.query(tx => tx.get(`cataloguePart/${DEMO_PART_ID}`))).toMatchObject({ displayName: '2" XFR 90' });
    expect(runtime.material.name).toContain("foremanhq-practice-material-");
    expect(runtime.material.pullURL).toBe("");
    expect(runtime.material.pushURL).toBe("");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses production mutators for list creation, room inheritance, parts, and quantity edits", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const runtime = await start();
    const materialListId = newId(), itemId = newId();
    await runtime.material.mutate.createMaterialList({ materialListId, jobId: DEMO_JOB_ID, name: "Mechanical request", roomId: DEMO_ROOM_ID, roomName: "Mechanical room" });
    await runtime.material.mutate.addItem({ materialListId, itemId, partDefinitionId: DEMO_PART_ID, quantity: 3 });
    await runtime.material.mutate.updateItemQuantity({ materialListId, itemId, quantity: 8 });
    expect(await runtime.material.query(tx => tx.get(`materialListItem/${itemId}`))).toMatchObject({ roomId: DEMO_ROOM_ID, quantity: "8" });
    await runtime.material.push({ now: true });
    await runtime.material.pull({ now: true });
    expect(await runtime.material.query(tx => tx.get(`materialListItem/${itemId}`))).toMatchObject({ roomId: DEMO_ROOM_ID, quantity: "8" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps notes and messages local, supports real tRPC hooks, and rejects unsupported routes", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const runtime = await start();
    const client = api.createClient({ links: [sandboxLink(runtime)] });
    expect(await client.rooms.updateNotes.mutate({ roomId: DEMO_ROOM_ID, notes: "Bring two 45s", expectedNotesRevision: 0 })).toEqual({ notes: "Bring two 45s", notesRevision: 1 });
    expect((await client.rooms.getJobRooms.query({ jobId: DEMO_JOB_ID })).floors[0]?.rooms[0]).toMatchObject({ notes: "Bring two 45s", notesRevision: 1 });
    const input = { jobId: DEMO_JOB_ID, clientId: newId(), body: "Practice message", attachmentIds: [] };
    const message = await client.chat.send.mutate(input);
    expect(message.author.id).toBe(runtime.userId);
    expect(await client.chat.send.mutate(input)).toEqual(message);
    expect((await client.chat.history.query({ jobId: DEMO_JOB_ID })).messages).toHaveLength(2);
    await expect(client.user.finishTutorial.mutate({ expectedUserId: runtime.userId, outcome: "completed" })).rejects.toThrow("not available in the practice session");
    await expect(client.rooms.getJobRooms.query({ jobId: newId() })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a new run or another account cannot see practice edits from a previous runtime", async () => {
    const first = await start("first-user");
    const second = await start("second-user");
    const listId = newId();
    await first.material.mutate.createMaterialList({ materialListId: listId, jobId: DEMO_JOB_ID, name: "Only first practice" });
    await first.request("rooms.updateNotes", { roomId: DEMO_ROOM_ID, notes: "First run", expectedNotesRevision: 0 });
    expect(first.runId).not.toBe(second.runId);
    expect(await second.material.query(tx => tx.get(`materialList/${listId}`))).toBeUndefined();
    expect(await second.request("rooms.getJobRooms", { jobId: DEMO_JOB_ID })).toMatchObject({ floors: [{ rooms: [expect.objectContaining({ notes: "" }), expect.anything(), expect.anything(), expect.anything()] }] });
  });
});
