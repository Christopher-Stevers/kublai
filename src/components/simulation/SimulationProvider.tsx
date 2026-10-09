"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  SIMULATION_CHANGE_EVENT,
  clearSimulationNavigationCache,
  setSimulationBrowserSession,
  simulationViewHeaders,
  type EmployeeSimulation,
} from "~/lib/employee-simulation";
const Context = createContext<EmployeeSimulation | null>(null);
export const useEmployeeSimulation = () => useContext(Context);
export function SimulationProvider({
  simulation,
  actorId,
  children,
}: {
  simulation: EmployeeSimulation | null;
  actorId: string;
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const view = simulation?.id ?? `account:${actorId}`;
    setSimulationBrowserSession({ view, simulationId: simulation?.id ?? null });
    const original = window.fetch.bind(window);
    const fetcher: typeof window.fetch = (input, init) => {
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        window.location.origin,
      );
      if (
        url.origin === window.location.origin &&
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/account-simulation"
      ) {
        const headers = new Headers(
          input instanceof Request ? input.headers : undefined,
        );
        new Headers(init?.headers).forEach((value, key) =>
          headers.set(key, value),
        );
        for (const [key, value] of Object.entries(simulationViewHeaders()))
          headers.set(key, value);
        return original(input, { ...init, headers });
      }
      return original(input, init);
    };
    window.fetch = fetcher;
    let active = true;
    queueMicrotask(() => {
      if (active) setReady(true);
    });
    const changed = (event: StorageEvent) => {
      if (event.key === SIMULATION_CHANGE_EVENT) window.location.reload();
    };
    const check = async () => {
      try {
        const response = await original("/api/account-simulation", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const state = (await response.json()) as { view: string };
        if (state.view !== view) window.location.replace("/dashboard");
      } catch {
        /* Retry when the connection returns. */
      }
    };
    const onFocus = () => void check();
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check();
    };
    const timer = simulation ? setInterval(onFocus, 15000) : null;
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
      if (window.fetch === fetcher) window.fetch = original;
    };
  }, [actorId, simulation]);
  return (
    <Context.Provider value={simulation}>
      {ready ? (
        children
      ) : (
        <p role="status" className="p-6">
          Opening your account…
        </p>
      )}
    </Context.Provider>
  );
}
export async function changeEmployeeSimulation(
  action: "start" | "end",
  employeeId?: string,
  abandonPending = false,
) {
  if (!abandonPending) {
    const { flushMaterialListChangesBeforeAccountSwitch } =
      await import("~/lib/replicache-material-list");
    await flushMaterialListChangesBeforeAccountSwitch();
  }
  const response = await fetch("/api/account-simulation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...(employeeId ? { employeeId } : {}) }),
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok)
    throw Error(data.error ?? "Could not change simulation. Try again.");
  await clearSimulationNavigationCache();
  try {
    localStorage.setItem(SIMULATION_CHANGE_EVENT, crypto.randomUUID());
  } catch {
    /* The current window still switches safely. */
  }
  window.location.assign(
    action === "start" ? "/dashboard" : "/dashboard/organization",
  );
}
export function EndSimulationButton() {
  const simulation = useEmployeeSimulation();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!simulation) return null;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        className="min-h-10 rounded-md bg-red-600 px-2 text-xs font-semibold whitespace-nowrap text-white hover:bg-red-700 disabled:opacity-60 sm:px-3 sm:text-sm"
        title={`Simulating ${simulation.employeeName}`}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void changeEmployeeSimulation("end").catch((e) => {
            setError(
              e instanceof Error ? e.message : "Could not end simulation.",
            );
            setBusy(false);
          });
        }}
      >
        {busy ? "Ending…" : "End Simulation"}
      </button>
      {error && (
        <p
          role="alert"
          className="bg-card text-destructive absolute top-full left-0 z-[100] mt-2 w-64 rounded border p-3 text-sm"
        >
          {error}
          <button
            type="button"
            className="mt-2 underline"
            onClick={() => {
              setBusy(true);
              void changeEmployeeSimulation("end", undefined, true).catch(
                (e) => {
                  setError(
                    e instanceof Error
                      ? e.message
                      : "Could not end simulation.",
                  );
                  setBusy(false);
                },
              );
            }}
          >
            End without saving pending offline edits
          </button>
        </p>
      )}
    </div>
  );
}
