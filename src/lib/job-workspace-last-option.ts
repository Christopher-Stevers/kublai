export type JobWorkspaceOptionId = "material-lists" | "rooms";
export type JobWorkspaceView = "options" | JobWorkspaceOptionId;

export type JobWorkspaceLocation = {
  jobId: string;
  view: JobWorkspaceView;
  materialListId: string | null;
};

const STORAGE_KEY = "foremenhq.job-workspace.last-location";
const LEGACY_OPTION_KEY = "foremenhq.job-workspace.last-option";

function canUseStorage() {
  return typeof window !== "undefined";
}

export function getLastJobWorkspaceLocation(): JobWorkspaceLocation | null {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<JobWorkspaceLocation>;
    if (typeof parsed.jobId !== "string" || !parsed.jobId) return null;
    if (
      parsed.view !== "options" &&
      parsed.view !== "material-lists" &&
      parsed.view !== "rooms"
    ) {
      return null;
    }
    return {
      jobId: parsed.jobId,
      view: parsed.view,
      materialListId:
        typeof parsed.materialListId === "string" ? parsed.materialListId : null,
    };
  } catch {
    return null;
  }
}

export function setLastJobWorkspaceLocation(location: JobWorkspaceLocation) {
  if (!canUseStorage()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(location));
    window.localStorage.removeItem(LEGACY_OPTION_KEY);
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export function clearLastJobWorkspaceLocation() {
  if (!canUseStorage()) return;

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_OPTION_KEY);
  } catch {
    // Ignore quota / private-mode failures.
  }
}
