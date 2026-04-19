export interface OfflineJobSummary {
  id: string;
  name: string;
  locationId: string | null;
  status: string | null;
  createdAt: string | Date;
  location: {
    id: string;
    name: string;
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
  locationId: string | null;
  foremanUserId?: string | null;
  status: string | null;
  createdAt: string | Date;
  location: {
    id: string;
    name: string;
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

const JOBS_LIST_KEY = "foremanhq.offline.jobs-list";
const JOB_DETAIL_PREFIX = "foremanhq.offline.job-detail";

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
}

export function getOfflineJobDetail(jobId: string): OfflineJobDetailEnvelope | null {
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
) {
  if (typeof window === "undefined") return;

  const envelope: OfflineJobDetailEnvelope = {
    version: 1,
    updatedAt: new Date().toISOString(),
    data,
  };

  window.localStorage.setItem(jobDetailKey(jobId), JSON.stringify(envelope));
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
