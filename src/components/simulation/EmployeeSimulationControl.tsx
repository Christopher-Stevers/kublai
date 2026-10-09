"use client";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import { changeEmployeeSimulation } from "./SimulationProvider";
import {
  simulationActionLabel,
  type SimulationAudit,
} from "~/lib/employee-simulation";
export function EmployeeSimulationControl({
  employeeId,
  name,
  disabled,
  disabledReason,
}: {
  employeeId: string;
  name: string;
  disabled: boolean;
  disabledReason?: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [history, setHistory] = useState<SimulationAudit[] | null>(null);
  const load = async () => {
    try {
      const response = await fetch(
        `/api/account-simulation?employeeId=${encodeURIComponent(employeeId)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        history?: SimulationAudit[];
      };
      if (!response.ok)
        throw Error(data.error ?? "Could not load simulation history.");
      setHistory(data.history ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load history.");
    }
  };
  return (
    <section className="border-t p-5" aria-label="Employee simulation">
      <h3 className="font-semibold">Experience this employee’s account</h3>
      <p className="text-muted-foreground mt-1 text-sm">
        Browse as {name} using their actual permissions. Changes save to their
        real account and record you in the audit trail. Simulation ends
        automatically after one hour.
      </p>
      <Button
        className="mt-3"
        variant="outline"
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true);
          setError("");
          void changeEmployeeSimulation("start", employeeId).catch((e) => {
            setError(
              e instanceof Error ? e.message : "Could not start simulation.",
            );
            setBusy(false);
          });
        }}
      >
        {busy ? "Starting…" : "Simulate employee"}
      </Button>
      {disabled && (
        <p className="text-muted-foreground mt-2 text-xs">
          {disabledReason ??
            "Activate the employee’s organization access before simulating."}
        </p>
      )}
      <details
        className="mt-4"
        onToggle={(e) => {
          if (e.currentTarget.open && history === null) void load();
        }}
      >
        <summary className="cursor-pointer text-sm">
          Simulation audit trail
        </summary>
        {history?.length === 0 && (
          <p className="text-muted-foreground mt-2 text-sm">
            No simulations yet.
          </p>
        )}
        <ol className="mt-2 space-y-2 text-sm">
          {history?.map((row) => (
            <li key={row.id} className="rounded border p-2">
              <p>
                {row.actorName} · {simulationActionLabel(row.action)}
              </p>
              <p className="text-muted-foreground text-xs">
                {new Date(row.createdAt).toLocaleString()} · {row.outcome}
              </p>
            </li>
          ))}
        </ol>
      </details>
      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}
