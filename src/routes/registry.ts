import type { JobWorkspaceOptionId } from "~/lib/job-workspace-last-option";

export type JourneyParameters = {
  jobId?: string;
  materialListId?: string;
  orderId?: string;
};
const jobHref = (p: JourneyParameters) =>
  `/jobs/${encodeURIComponent(p.jobId ?? "")}`;
const listHref = (p: JourneyParameters) =>
  `/jobs/material-lists/${encodeURIComponent(p.materialListId ?? "")}`;
export const screenCode = {
  jobs: () => import("~/app/jobs/JobsClient"),
  job: () => import("~/components/jobs/JobWorkspaceOptions"),
  materialLists: () =>
    import("~/components/materialLists/JobMaterialListsView"),
  materialList: () => import("~/components/materialLists/MaterialListScreen"),
  drawings: () => import("~/components/jobs/JobDrawingsView"),
  chat: () => import("~/components/jobs/JobChatView"),
  rooms: () => import("~/components/jobs/JobRoomsView"),
  documents: () => import("~/components/jobs/JobDocumentsView"),
  systems: () => import("~/components/jobs/JobSystemsView"),
};
async function jobData(p: JourneyParameters, signal: AbortSignal) {
  if (signal.aborted || !p.jobId) return;
  const [{ tryGetMaterialListReplicache }, { readJobDetail }] =
    await Promise.all([
      import("~/lib/replicache-material-list"),
      import("~/hooks/use-replicache-jobs"),
    ]);
  if (signal.aborted) return;
  const rep = tryGetMaterialListReplicache();
  if (rep)
    await rep.query((tx) =>
      signal.aborted ? null : readJobDetail(tx, p.jobId!, false),
    );
}
async function listData(p: JourneyParameters, signal: AbortSignal) {
  if (signal.aborted || !p.materialListId) return jobData(p, signal);
  const { tryGetMaterialListReplicache } =
    await import("~/lib/replicache-material-list");
  if (signal.aborted) return;
  const rep = tryGetMaterialListReplicache();
  if (rep)
    await rep.query(async (tx) => {
      if (signal.aborted) return;
      await tx.get(`materialList/${p.materialListId}`);
      if (!signal.aborted)
        await tx
          .scan({ indexName: "itemsByList", prefix: p.materialListId! })
          .values()
          .toArray();
    });
}
const noData = async (_p: JourneyParameters, _signal: AbortSignal) => undefined;
// Writes use the same screen preparation; preparation never performs the write.
// Private remote chat/drawing contents are not fetched or retained speculatively.
export const journeyRegistry = {
  coldstart: { code: screenCode.jobs, data: noData, sourceHref: () => "/jobs" },
  openjob: { code: screenCode.job, data: jobData, sourceHref: () => "/jobs" },
  switchjobtabs: {
    code: screenCode.materialLists,
    data: jobData,
    sourceHref: jobHref,
  },
  openmateriallist: {
    code: screenCode.materialList,
    data: listData,
    sourceHref: (p: JourneyParameters) => `${jobHref(p)}/material-lists`,
  },
  changeqty: {
    code: screenCode.materialList,
    data: listData,
    sourceHref: listHref,
  },
  receiveline: {
    code: screenCode.materialList,
    data: listData,
    sourceHref: (p: JourneyParameters) =>
      `${listHref(p)}?orderId=${encodeURIComponent(p.orderId ?? "")}`,
  },
  opensheetpinch: {
    code: screenCode.drawings,
    data: jobData,
    sourceHref: (p: JourneyParameters) => `${jobHref(p)}/drawings`,
  },
  sendchat: {
    code: screenCode.chat,
    data: noData,
    sourceHref: (p: JourneyParameters) => `${jobHref(p)}/chat`,
  },
} as const;
export type JourneyId = keyof typeof journeyRegistry;
const loaded = new Map<() => Promise<unknown>, Promise<unknown>>();
function prepareCode(load: () => Promise<unknown>) {
  let work = loaded.get(load);
  if (!work) {
    work = load().catch((error) => {
      loaded.delete(load);
      throw error;
    });
    loaded.set(load, work);
  }
  return work;
}
export async function prepareJourney(
  id: JourneyId,
  parameters: JourneyParameters,
  signal: AbortSignal,
) {
  if (signal.aborted) return;
  const entry = journeyRegistry[id];
  // Dynamic imports and an already-running IndexedDB read cannot be cancelled;
  // abort prevents later reads and navigation. No private data is cached here.
  await Promise.allSettled([
    prepareCode(entry.code),
    entry.data(parameters, signal),
  ]);
}
export async function prepareWorkspaceOption(
  option: JobWorkspaceOptionId,
  jobId: string,
  signal: AbortSignal,
) {
  const journey =
    option === "material-lists" || option === "tool-requests"
      ? "switchjobtabs"
      : option === "drawings"
        ? "opensheetpinch"
        : option === "chat"
          ? "sendchat"
          : null;
  if (journey) return prepareJourney(journey, { jobId }, signal);
  const load =
    option === "rooms"
      ? screenCode.rooms
      : option === "documents"
        ? screenCode.documents
        : option === "systems"
          ? screenCode.systems
          : null;
  if (!signal.aborted && load)
    await Promise.allSettled([prepareCode(load), jobData({ jobId }, signal)]);
}
