export const SIMULATION_COOKIE = "foremanhq_employee_simulation";
export const SIMULATION_VIEW_HEADER = "x-foremanhq-session-view";
export const SIMULATION_CHANGE_EVENT = "foremanhq-simulation-change";
export type EmployeeSimulation = {
  id: string;
  actorId: string;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
  expiresAt: string;
};
export type SimulationAudit = {
  id: string;
  actorName: string;
  action: string;
  outcome: string;
  createdAt: string;
};

type BrowserSession = { view: string; simulationId: string | null };
let session: BrowserSession | null = null;
export function setSimulationBrowserSession(next: BrowserSession) {
  session = next;
}
export function simulationCacheName(base: string) {
  return session?.simulationId
    ? `${base}-simulation-${session.simulationId}`
    : base;
}
export function simulationViewHeaders(): Record<string, string> {
  return session ? { [SIMULATION_VIEW_HEADER]: session.view } : {};
}

/** Cached HTML/RSC shells must not reopen the previous identity after switching. */
export async function clearSimulationNavigationCache() {
  if (!("caches" in globalThis)) return;
  try {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => /^foremenhq-offline-shell-.*:pages$/.test(name))
        .map((name) => caches.delete(name)),
    );
  } catch {
    // Cache storage is unavailable in some privacy modes; still reload online.
  }
}

export function simulationActionLabel(action: string) {
  if (action.startsWith("Simulation ")) return action;
  if (action.startsWith("Document editor save ")) return "Document edited";
  if (/^(POST|PUT|PATCH|DELETE) \/api\//.test(action)) {
    const path = action.split(" ")[1] ?? "";
    const area = path.includes("job-documents")
      ? "Documents"
      : path.includes("job-rooms")
        ? "Rooms"
        : path.includes("material-list")
          ? "Material lists"
          : path.includes("catalogue")
            ? "Catalogue"
            : path.includes("chat")
              ? "Chat"
              : path.includes("drawing")
                ? "Drawings"
                : "App";
    return `${area} change requested`;
  }
  const domains: Record<string, string> = {
    user: "Account",
    materialList: "Material list",
    job: "Job",
    organization: "Organization",
    conversations: "Chat",
    jobChat: "Job chat",
    push: "Device notifications",
    payment: "Billing",
    rooms: "Rooms",
    drawings: "Drawings",
    timesheets: "Timesheets",
    catalogue: "Catalogue",
    part: "Part",
    assets: "Equipment",
  };
  const [domain, verb] = action.split(".");
  if (!domain || !verb) return "App change";
  const words = verb.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `${domains[domain] ?? domain} · ${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}
