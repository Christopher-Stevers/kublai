// @vitest-environment node
import { expect, it } from "vitest";
import { ensureDefaultDocumentFolders } from "./default-folders";
import { emptyDocumentState, applyDocumentAction, type DocumentActor } from "./domain";
const actor: DocumentActor = { userId: "owner", jobId: "job", canWrite: true, canManage: true, memberIds: ["owner"] };
it("provides three stable default folders to new and existing jobs without duplicates", () => {
  const state = ensureDefaultDocumentFolders(emptyDocumentState(), "job", "owner");
  expect(state.folders.map(f => f.name)).toEqual(["Submittals", "Packing Slips", "Specifications"]);
  const ids = state.folders.map(f => f.id);
  ensureDefaultDocumentFolders(state, "job", "owner");
  expect(state.folders).toHaveLength(3);
  expect(ensureDefaultDocumentFolders(emptyDocumentState(), "job", "other").folders.map(f => f.id)).toEqual(ids);
  expect(ensureDefaultDocumentFolders(emptyDocumentState(), "other-job", "owner").folders.map(f => f.id)).not.toEqual(ids);
});
it("preserves existing folder IDs, contents and permissions", () => {
  const state = emptyDocumentState();
  const { id } = applyDocumentAction(state, actor, { action: "createFolder", name: "Packing Slips" });
  state.folders[0]!.permissions = [{ userId: "owner", role: "manager" }];
  ensureDefaultDocumentFolders(state, "job", "owner");
  expect(state.folders.find(f => f.name === "Packing Slips")).toMatchObject({ id, permissions: [{ userId: "owner", role: "manager" }] });
  expect(state.folders).toHaveLength(3);
});
it("prevents renaming or moving all default folders even for managers", () => {
  const state = ensureDefaultDocumentFolders(emptyDocumentState(), "job", "owner");
  const custom = applyDocumentAction(state, actor, { action: "createFolder", name: "Other" }).id;
  for (const folder of state.folders.slice(0,3)) {
    expect(() => applyDocumentAction(state, actor, { action: "updateFolder", folderId: folder.id, name: "Renamed" })).toThrow(/cannot be renamed/);
    expect(() => applyDocumentAction(state, actor, { action: "updateFolder", folderId: folder.id, parentId: custom })).toThrow(/cannot be renamed/);
  }
  expect(() => applyDocumentAction(state, actor, { action: "updateFolder", folderId: custom, name: "Renamed" })).not.toThrow();
});
