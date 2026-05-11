import { getOfflineDexieDb } from "~/lib/offline-dexie-db";
import { setOfflineIdMappings } from "~/lib/offline-id-map";

export interface OfflineJobSummary {
  id: string;
  name: string;
  poNumber?: string | null;
  locationId: string | null;
  foremanName?: string | null;
  status: string | null;
  createdAt: string | Date;
  location: {
    id: string;
    name: string;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  foreman: {
    id: string;
    name: string;
  } | null;
  materialListCount: number;
}

export interface OfflineJobMaterialListSummary {
  id: string;
  name: string;
  createdAt: string | Date;
  itemCount: number;
  materialTotal: number;
  foreman: {
    id: string;
    name: string;
  } | null;
  contributors?: Array<{
    id: string;
    name: string;
    email?: string | null;
  }>;
}

export interface OfflineJobDetail {
  id: string;
  name: string;
  poNumber?: string | null;
  locationId: string | null;
  foremanUserId?: string | null;
  foremanName?: string | null;
  status: string | null;
  createdAt: string | Date;
  location: {
    id: string;
    name: string;
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    region?: string | null;
    postalCode?: string | null;
    country?: string | null;
  } | null;
  foreman: {
    id: string;
    name: string;
  } | null;
}

export interface OfflineJobsListEnvelope {
  version: 1;
  updatedAt: string;
  data: OfflineJobSummary[];
}

export interface OfflineJobDetailEnvelope {
  version: 1;
  updatedAt: string;
  data: {
    job: OfflineJobDetail;
    materialLists: OfflineJobMaterialListSummary[];
  };
}

export type OfflineEntityMutation =
  | {
      type: "createJob";
      clientMutationId?: string;
      localJobId: string;
      name: string;
      locationId?: string | null;
      queuedAt: string;
    }
  | {
      type: "updateJob";
      clientMutationId?: string;
      jobId: string;
      name?: string | null;
      locationId?: string | null;
      poNumber?: string | null;
      foremanName?: string | null;
      queuedAt: string;
    }
  | {
      type: "createMaterialList";
      clientMutationId?: string;
      localMaterialListId: string;
      localJobId: string;
      name?: string;
      queuedAt: string;
    }
  | {
      type: "deleteJob";
      clientMutationId?: string;
      jobId: string;
      queuedAt: string;
    }
  | {
      type: "deleteMaterialList";
      clientMutationId?: string;
      materialListId: string;
      jobId: string;
      queuedAt: string;
    };

const JOBS_LIST_KEY = "foremanhq.offline.jobs-list";
const JOB_DETAIL_PREFIX = "foremanhq.offline.job-detail";
const ENTITY_QUEUE_KEY = "foremanhq.offline.entity-mutation-queue";
export const OFFLINE_JOBS_EVENT = "foremanhq:offline-jobs-changed";

function notifyOfflineJobsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(OFFLINE_JOBS_EVENT));
}

function entityMutationIdPart(mutation: OfflineEntityMutation) {
  if (mutation.type === "createJob") return mutation.localJobId;
  if (mutation.type === "createMaterialList")
    return mutation.localMaterialListId;
  if (mutation.type === "deleteMaterialList") return mutation.materialListId;
  return mutation.jobId;
}

function deterministicEntityMutationId(mutation: OfflineEntityMutation) {
  return `${mutation.type}:${mutation.queuedAt}:${entityMutationIdPart(mutation)}`;
}

function withEntityClientMutationId(mutation: OfflineEntityMutation) {
  return {
    ...mutation,
    clientMutationId:
      mutation.clientMutationId ?? deterministicEntityMutationId(mutation),
  } as OfflineEntityMutation & { clientMutationId: string };
}

function entityMutationEntity(mutation: OfflineEntityMutation) {
  if (
    mutation.type === "createMaterialList" ||
    mutation.type === "deleteMaterialList"
  ) {
    return {
      entityType: "materialList" as const,
      entityId: entityMutationIdPart(mutation),
    };
  }
  return {
    entityType: "job" as const,
    entityId: entityMutationIdPart(mutation),
  };
}

function writeEntityQueueToDexie(queue: OfflineEntityMutation[]) {
  const db = getOfflineDexieDb();
  if (!db) return;

  void db.transaction("rw", db.entityMutationQueue, async () => {
    await db.entityMutationQueue.clear();
    if (queue.length === 0) return;
    await db.entityMutationQueue.bulkPut(
      queue.map((mutation, index) => {
        const normalized = withEntityClientMutationId(mutation);
        const entity = entityMutationEntity(normalized);
        return {
          id: normalized.clientMutationId,
          order: index,
          entityType: entity.entityType,
          entityId: entity.entityId,
          type: normalized.type,
          queuedAt: normalized.queuedAt,
          value: normalized,
        };
      }),
    );
  });
}

function jobDetailKey(jobId: string) {
  return `${JOB_DETAIL_PREFIX}:${jobId}`;
}

export function getOfflineJobsList(): OfflineJobsListEnvelope | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(JOBS_LIST_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OfflineJobsListEnvelope;
  } catch {
    return null;
  }
}

export function setOfflineJobsList(data: OfflineJobSummary[]) {
  if (typeof window === "undefined") return;

  const envelope: OfflineJobsListEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(JOBS_LIST_KEY, JSON.stringify(envelope));
  void writeJobsListToDexie(envelope);
  notifyOfflineJobsChanged();
}

async function writeJobsListToDexie(envelope: OfflineJobsListEnvelope) {
  const db = getOfflineDexieDb();
  if (!db) return;

  const nextJobIds = new Set(envelope.data.map((job) => job.id));
  const existingRows = await db.jobSummaries.toArray();
  const removedJobIds = existingRows
    .filter((row) => !nextJobIds.has(row.id))
    .map((row) => row.id);

  await db.transaction("rw", db.jobSummaries, db.jobDetails, async () => {
    if (removedJobIds.length > 0) {
      await db.jobSummaries.bulkDelete(removedJobIds);
      await db.jobDetails.bulkDelete(removedJobIds);
    }

    await db.jobSummaries.bulkPut(
      envelope.data.map((job) => ({
        id: job.id,
        name: job.name,
        locationId: job.locationId,
        status: job.status,
        createdAt:
          job.createdAt instanceof Date
            ? job.createdAt.toISOString()
            : String(job.createdAt),
        updatedAt: envelope.updatedAt,
        value: job,
      })),
    );
  });
}

export function getOfflineJobDetail(
  jobId: string,
): OfflineJobDetailEnvelope | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(jobDetailKey(jobId));
  if (!raw) return null;

  try {
    return JSON.parse(raw) as OfflineJobDetailEnvelope;
  } catch {
    return null;
  }
}

export function setOfflineJobDetail(
  jobId: string,
  data: OfflineJobDetailEnvelope["data"],
  options?: { notify?: boolean },
) {
  if (typeof window === "undefined") return;

  const envelope: OfflineJobDetailEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(jobDetailKey(jobId), JSON.stringify(envelope));
  void writeJobDetailToDexie(jobId, envelope);
  if (options?.notify !== false) {
    notifyOfflineJobsChanged();
  }
}

async function writeJobDetailToDexie(
  jobId: string,
  envelope: OfflineJobDetailEnvelope,
) {
  const db = getOfflineDexieDb();
  if (!db) return;

  await db.jobDetails.put({
    id: jobId,
    updatedAt: envelope.updatedAt,
    value: envelope.data,
  });
}

export function removeOfflineJobDetail(jobId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(jobDetailKey(jobId));
  const db = getOfflineDexieDb();
  if (db) void db.jobDetails.delete(jobId);
  notifyOfflineJobsChanged();
}

export function removeOfflineJobFromCache(jobId: string) {
  setOfflineJobsList(
    (getOfflineJobsList()?.data ?? []).filter((job) => job.id !== jobId),
  );
  const db = getOfflineDexieDb();
  if (db) void db.jobSummaries.delete(jobId);
  removeOfflineJobDetail(jobId);
}

export function getOfflineJobDetailIds(): string[] {
  if (typeof window === "undefined") return [];

  const ids: string[] = [];

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key?.startsWith(`${JOB_DETAIL_PREFIX}:`)) continue;

    ids.push(key.slice(`${JOB_DETAIL_PREFIX}:`.length));
  }

  return ids;
}

export function getOfflineEntityMutationQueue(): OfflineEntityMutation[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(ENTITY_QUEUE_KEY);
  if (!raw) return [];

  try {
    return (JSON.parse(raw) as OfflineEntityMutation[]).map(
      withEntityClientMutationId,
    );
  } catch {
    return [];
  }
}

export function setOfflineEntityMutationQueue(queue: OfflineEntityMutation[]) {
  if (typeof window === "undefined") return;
  const normalized = Array.from(
    new Map(
      queue
        .map(withEntityClientMutationId)
        .map((mutation) => [mutation.clientMutationId, mutation]),
    ).values(),
  );
  if (normalized.length === 0) {
    window.localStorage.removeItem(ENTITY_QUEUE_KEY);
  } else {
    window.localStorage.setItem(ENTITY_QUEUE_KEY, JSON.stringify(normalized));
  }
  writeEntityQueueToDexie(normalized);
  notifyOfflineJobsChanged();
}

export function enqueueOfflineEntityMutation(mutation: OfflineEntityMutation) {
  setOfflineEntityMutationQueue([
    ...getOfflineEntityMutationQueue(),
    {
      ...mutation,
      clientMutationId: mutation.clientMutationId ?? crypto.randomUUID(),
    },
  ]);
}

export function getPendingDeletedJobIds() {
  return new Set(
    getOfflineEntityMutationQueue()
      .filter(
        (
          mutation,
        ): mutation is Extract<OfflineEntityMutation, { type: "deleteJob" }> =>
          mutation.type === "deleteJob",
      )
      .map((mutation) => mutation.jobId),
  );
}

export function getPendingDeletedMaterialListIds(jobId?: string) {
  return new Set(
    getOfflineEntityMutationQueue()
      .filter(
        (
          mutation,
        ): mutation is Extract<
          OfflineEntityMutation,
          { type: "deleteMaterialList" }
        > =>
          mutation.type === "deleteMaterialList" &&
          (!jobId || mutation.jobId === jobId),
      )
      .map((mutation) => mutation.materialListId),
  );
}

function removeMaterialListFromCachedJob(
  jobId: string,
  materialListId: string,
) {
  const detail = getOfflineJobDetail(jobId)?.data;
  if (detail) {
    setOfflineJobDetail(jobId, {
      job: detail.job,
      materialLists: detail.materialLists.filter(
        (list) => list.id !== materialListId,
      ),
    });
  }

  const jobs = getOfflineJobsList()?.data ?? [];
  setOfflineJobsList(
    jobs.map((job) =>
      job.id === jobId
        ? {
            ...job,
            materialListCount: Math.max(0, (job.materialListCount ?? 0) - 1),
          }
        : job,
    ),
  );
}

export function tombstoneOfflineJob(jobId: string) {
  const queue = getOfflineEntityMutationQueue();
  const isLocalOnlyJob = jobId.startsWith("offline-job-");
  const detail = getOfflineJobDetail(jobId)?.data;
  const materialListIds = detail?.materialLists.map((list) => list.id) ?? [];

  setOfflineJobsList(
    (getOfflineJobsList()?.data ?? []).filter((job) => job.id !== jobId),
  );
  removeOfflineJobDetail(jobId);

  if (isLocalOnlyJob) {
    setOfflineEntityMutationQueue(
      queue.filter((mutation) => {
        if (mutation.type === "createJob" && mutation.localJobId === jobId)
          return false;
        if (
          mutation.type === "createMaterialList" &&
          mutation.localJobId === jobId
        )
          return false;
        if (
          mutation.type === "deleteMaterialList" &&
          materialListIds.includes(mutation.materialListId)
        )
          return false;
        return true;
      }),
    );
    return;
  }

  setOfflineEntityMutationQueue([
    ...queue.filter(
      (mutation) =>
        !(mutation.type === "deleteJob" && mutation.jobId === jobId) &&
        !(
          mutation.type === "deleteMaterialList" &&
          materialListIds.includes(mutation.materialListId)
        ),
    ),
    { type: "deleteJob", jobId, queuedAt: new Date().toISOString() },
  ]);
}

export function purgeAutoCreatedOfflineJobGhosts(
  serverJobs: OfflineJobSummary[],
) {
  const serverJobIds = new Set(serverJobs.map((job) => job.id));
  const jobs = getOfflineJobsList()?.data ?? [];
  const ghostJobIds = new Set(
    jobs
      .filter(
        (job) =>
          job.name.trim().toLowerCase() === "new job" &&
          !serverJobIds.has(job.id),
      )
      .map((job) => job.id),
  );

  for (const jobId of getOfflineJobDetailIds()) {
    const detail = getOfflineJobDetail(jobId)?.data;
    if (
      detail?.job.name.trim().toLowerCase() === "new job" &&
      !serverJobIds.has(jobId)
    ) {
      ghostJobIds.add(jobId);
    }
  }

  void (async () => {
    const db = getOfflineDexieDb();
    if (!db) return;

    const rows = await db.jobSummaries.toArray();
    for (const row of rows) {
      const job = row.value as OfflineJobSummary;
      if (
        job.name.trim().toLowerCase() === "new job" &&
        !serverJobIds.has(job.id)
      ) {
        ghostJobIds.add(job.id);
      }
    }

    const detailRows = await db.jobDetails.toArray();
    for (const row of detailRows) {
      const detail = row.value as OfflineJobDetailEnvelope["data"];
      if (
        detail.job.name.trim().toLowerCase() === "new job" &&
        !serverJobIds.has(row.id)
      ) {
        ghostJobIds.add(row.id);
      }
    }

    const ids = Array.from(ghostJobIds);
    if (ids.length === 0) return;

    const materialListHeaders = await db.materialListHeaders
      .where("jobId")
      .anyOf(ids)
      .toArray();
    const materialListIds = materialListHeaders.map((header) => header.id);

    await db.jobSummaries.bulkDelete(ids);
    await db.jobDetails.bulkDelete(ids);
    if (materialListIds.length > 0) {
      await db.materialListHeaders.bulkDelete(materialListIds);
      await db.materialLists.bulkDelete(materialListIds);
      await db.materialListItems
        .where("materialListId")
        .anyOf(materialListIds)
        .delete();
    }

    notifyOfflineJobsChanged();
  })();

  const ids = Array.from(ghostJobIds);
  if (ids.length === 0) return;

  setOfflineJobsList(jobs.filter((job) => !ids.includes(job.id)));
  for (const jobId of ids) {
    removeOfflineJobDetail(jobId);
  }
  setOfflineEntityMutationQueue(
    getOfflineEntityMutationQueue().filter((mutation) => {
      if (mutation.type === "createJob" && ids.includes(mutation.localJobId)) {
        return false;
      }
      if (
        mutation.type === "createMaterialList" &&
        ids.includes(mutation.localJobId)
      ) {
        return false;
      }
      if (
        (mutation.type === "updateJob" || mutation.type === "deleteJob") &&
        ids.includes(mutation.jobId)
      ) {
        return false;
      }
      if (
        mutation.type === "deleteMaterialList" &&
        ids.includes(mutation.jobId)
      ) {
        return false;
      }
      return true;
    }),
  );
}

export function clearPendingOfflineJobDelete(jobId: string) {
  setOfflineEntityMutationQueue(
    getOfflineEntityMutationQueue().filter(
      (mutation) =>
        !(mutation.type === "deleteJob" && mutation.jobId === jobId),
    ),
  );
}

export function tombstoneOfflineMaterialList(
  jobId: string,
  materialListId: string,
) {
  const queue = getOfflineEntityMutationQueue();
  const isLocalOnlyList = materialListId.startsWith("offline-list-");

  removeMaterialListFromCachedJob(jobId, materialListId);

  if (isLocalOnlyList) {
    setOfflineEntityMutationQueue(
      queue.filter(
        (mutation) =>
          !(
            mutation.type === "createMaterialList" &&
            mutation.localMaterialListId === materialListId
          ) &&
          !(
            mutation.type === "deleteMaterialList" &&
            mutation.materialListId === materialListId
          ),
      ),
    );
    return;
  }

  setOfflineEntityMutationQueue([
    ...queue.filter(
      (mutation) =>
        !(
          mutation.type === "deleteMaterialList" &&
          mutation.materialListId === materialListId
        ),
    ),
    {
      type: "deleteMaterialList",
      materialListId,
      jobId,
      queuedAt: new Date().toISOString(),
    },
  ]);
}

export function createOfflineJob(name: string, locationId?: string | null) {
  const now = new Date().toISOString();
  const localJobId = `offline-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job: OfflineJobDetail = {
    id: localJobId,
    name,
    locationId: locationId ?? null,
    status: "draft",
    createdAt: now,
    location: null,
    foreman: null,
  };

  const list = getOfflineJobsList()?.data ?? [];
  setOfflineJobsList([
    {
      ...job,
      materialListCount: 0,
    },
    ...list,
  ]);
  setOfflineJobDetail(localJobId, { job, materialLists: [] });
  enqueueOfflineEntityMutation({
    type: "createJob",
    localJobId,
    name,
    locationId: locationId ?? null,
    queuedAt: now,
  });

  return job;
}

export function updateOfflineJob(
  jobId: string,
  updates: {
    name?: string | null;
    locationId?: string | null;
    poNumber?: string | null;
    foremanName?: string | null;
  },
) {
  const now = new Date().toISOString();
  const list = getOfflineJobsList()?.data ?? [];
  setOfflineJobsList(
    list.map((job) =>
      job.id === jobId
        ? {
            ...job,
            name: updates.name ?? job.name,
            locationId: updates.locationId ?? job.locationId,
            poNumber: updates.poNumber ?? job.poNumber,
            foremanName: updates.foremanName ?? job.foremanName,
            foreman: {
              id: job.foreman?.id ?? "",
              name: updates.foremanName ?? job.foreman?.name ?? "",
            },
          }
        : job,
    ),
  );

  const detail = getOfflineJobDetail(jobId)?.data;
  if (detail) {
    setOfflineJobDetail(jobId, {
      job: {
        ...detail.job,
        name: updates.name ?? detail.job.name,
        locationId: updates.locationId ?? detail.job.locationId,
        poNumber: updates.poNumber ?? detail.job.poNumber,
        foremanName: updates.foremanName ?? detail.job.foremanName,
        foreman: {
          id: detail.job.foreman?.id ?? "",
          name: updates.foremanName ?? detail.job.foreman?.name ?? "",
        },
      },
      materialLists: detail.materialLists,
    });
  }

  enqueueOfflineEntityMutation({
    type: "updateJob",
    jobId,
    name: updates.name,
    locationId: updates.locationId,
    poNumber: updates.poNumber,
    foremanName: updates.foremanName,
    queuedAt: now,
  });
}

export function remapOfflineJobId(
  localJobId: string,
  serverJob: OfflineJobDetail,
  serverMaterialLists: OfflineJobMaterialListSummary[] = [],
) {
  const localDetail = getOfflineJobDetail(localJobId)?.data;
  const mergedDetail = {
    job: {
      ...(localDetail?.job ?? serverJob),
      ...serverJob,
      id: serverJob.id,
    },
    materialLists:
      localDetail?.materialLists.map((list) => ({ ...list })) ??
      serverMaterialLists,
  };

  const remappedJobs = (getOfflineJobsList()?.data ?? []).map((job) =>
    job.id === localJobId
      ? {
          ...job,
          id: serverJob.id,
          name: serverJob.name,
          locationId: serverJob.locationId,
          poNumber: serverJob.poNumber,
          foremanName: serverJob.foremanName,
          status: serverJob.status,
          location: serverJob.location,
          foreman: serverJob.foreman,
        }
      : job,
  );
  setOfflineJobsList(
    Array.from(new Map(remappedJobs.map((job) => [job.id, job])).values()),
  );
  setOfflineJobDetail(serverJob.id, mergedDetail);
  if (localJobId !== serverJob.id) {
    setOfflineIdMappings({ [localJobId]: serverJob.id });
    removeOfflineJobDetail(localJobId);
  }

  setOfflineEntityMutationQueue(
    getOfflineEntityMutationQueue().map((mutation) => {
      if (
        mutation.type === "createMaterialList" &&
        mutation.localJobId === localJobId
      ) {
        return { ...mutation, localJobId: serverJob.id };
      }
      if (mutation.type === "updateJob" && mutation.jobId === localJobId) {
        return { ...mutation, jobId: serverJob.id };
      }
      if (mutation.type === "deleteJob" && mutation.jobId === localJobId) {
        return { ...mutation, jobId: serverJob.id };
      }
      if (
        mutation.type === "deleteMaterialList" &&
        mutation.jobId === localJobId
      ) {
        return { ...mutation, jobId: serverJob.id };
      }
      return mutation;
    }),
  );
}

export function remapOfflineMaterialListId(
  jobId: string,
  localMaterialListId: string,
  serverMaterialListId: string,
) {
  const detail = getOfflineJobDetail(jobId)?.data;
  if (detail) {
    setOfflineJobDetail(jobId, {
      job: detail.job,
      materialLists: detail.materialLists.map((list) =>
        list.id === localMaterialListId
          ? { ...list, id: serverMaterialListId }
          : list,
      ),
    });
  }
  if (localMaterialListId !== serverMaterialListId) {
    setOfflineIdMappings({ [localMaterialListId]: serverMaterialListId });
  }

  setOfflineEntityMutationQueue(
    getOfflineEntityMutationQueue().map((mutation) => {
      if (
        mutation.type === "deleteMaterialList" &&
        mutation.materialListId === localMaterialListId
      ) {
        return { ...mutation, materialListId: serverMaterialListId };
      }
      return mutation;
    }),
  );
}

function formatTorontoMaterialListDate(from = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(from);
}

export function formatDefaultMaterialListName(
  listNumber: number,
  from = new Date(),
) {
  return `${formatTorontoMaterialListDate(from)} -${listNumber.toString()}`;
}

export function normalizeLegacyOfflineMaterialListName(
  name: string,
  createdAt?: string | Date | null,
) {
  const match = name.match(/^Offline Material List\s+(\d+)$/i);
  if (!match?.[1]) return name;

  const date = createdAt ? new Date(createdAt) : new Date();
  return formatDefaultMaterialListName(
    Number(match[1]),
    Number.isNaN(date.getTime()) ? new Date() : date,
  );
}

export function createOfflineMaterialList(jobId: string, name?: string) {
  const now = new Date().toISOString();
  const localMaterialListId = `offline-list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const detail = getOfflineJobDetail(jobId)?.data;
  const materialListName =
    name?.trim() ||
    formatDefaultMaterialListName(
      (detail?.materialLists.length ?? 0) + 1,
      new Date(now),
    );
  const summary: OfflineJobMaterialListSummary = {
    id: localMaterialListId,
    name: materialListName,
    createdAt: now,
    itemCount: 0,
    materialTotal: 0,
    foreman: detail?.job.foreman ?? null,
    contributors: [],
  };

  if (detail) {
    setOfflineJobDetail(jobId, {
      job: detail.job,
      materialLists: [summary, ...detail.materialLists],
    });
  }

  const jobs = getOfflineJobsList()?.data ?? [];
  setOfflineJobsList(
    jobs.map((job) =>
      job.id === jobId
        ? { ...job, materialListCount: (job.materialListCount ?? 0) + 1 }
        : job,
    ),
  );

  enqueueOfflineEntityMutation({
    type: "createMaterialList",
    localMaterialListId,
    localJobId: jobId,
    name: materialListName,
    queuedAt: now,
  });

  return { id: localMaterialListId, name: materialListName, createdAt: now };
}
