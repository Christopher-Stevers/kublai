import { makeSnapshotSource, readSnapshotState, type SnapshotSource } from "./snapshot-source";

/** Older account/invite defaults point at the standalone job overview. */
export function landingPageDestination(source: SnapshotSource | null): string {
  if (!source) return "/dashboard";
  const url = new URL(source.href, "https://foremanhq.invalid");
  const match = /^\/dashboard\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i.exec(url.pathname);
  const jobId = match?.[1];
  if (!jobId) return source.href;
  const state = readSnapshotState(url.hash) ?? { version: 1 as const };
  // Explicit nested captures must retain their document/drawing destination.
  if (state.drawing || state.document) return source.href;
  return makeSnapshotSource(`/dashboard${url.search}`, {
    ...state,
    workspace: state.workspace?.jobId === jobId
      ? state.workspace
      : { jobId, view: "options", materialListId: null },
  }, source.title).href;
}
