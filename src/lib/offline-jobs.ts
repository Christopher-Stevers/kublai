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
      localJobId: string;
      name: string;
      locationId?: string | null;
      queuedAt: string;
    }
  | {
      type: "createMaterialList";
      localMaterialListId: string;
      localJobId: string;
      name?: string;
      queuedAt: string;
    }
  | {
      type: "deleteJob";
      jobId: string;
      queuedAt: string;
    }
  | {
      type: "deleteMaterialList";
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
  notifyOfflineJobsChanged();
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
  if (options?.notify !== false) {
    notifyOfflineJobsChanged();
  }
}

export function removeOfflineJobDetail(jobId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(jobDetailKey(jobId));
  notifyOfflineJobsChanged();
}

export function removeOfflineJobFromCache(jobId: string) {
  setOfflineJobsList(
    (getOfflineJobsList()?.data ?? []).filter((job) => job.id !== jobId),
  );
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
    return JSON.parse(raw) as OfflineEntityMutation[];
  } catch {
    return [];
  }
}

export function setOfflineEntityMutationQueue(queue: OfflineEntityMutation[]) {
  if (typeof window === "undefined") return;
  if (queue.length === 0) {
    window.localStorage.removeItem(ENTITY_QUEUE_KEY);
  } else {
    window.localStorage.setItem(ENTITY_QUEUE_KEY, JSON.stringify(queue));
  }
  notifyOfflineJobsChanged();
}

export function enqueueOfflineEntityMutation(mutation: OfflineEntityMutation) {
  setOfflineEntityMutationQueue([...getOfflineEntityMutationQueue(), mutation]);
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

export function createOfflineMaterialList(jobId: string, name?: string) {
  const now = new Date().toISOString();
  const localMaterialListId = `offline-list-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const detail = getOfflineJobDetail(jobId)?.data;
  const materialListName =
    name?.trim() ||
    `Offline Material List ${((detail?.materialLists.length ?? 0) + 1).toString()}`;
  const summary: OfflineJobMaterialListSummary = {
    id: localMaterialListId,
    name: materialListName,
    createdAt: now,
    itemCount: 0,
    materialTotal: 0,
    foreman: detail?.job.foreman ?? null,
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
