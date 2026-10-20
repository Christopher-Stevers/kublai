"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { FormSkeleton } from "~/components/ui/skeleton";
import { PipeSpecEditor } from "~/components/jobs/PipeSpecEditor";
import { defaultPipeSpec, pipeSystemCode, type PipeSpec } from "~/lib/pipe-spec";
import { PIPE_SYSTEM_NAMES } from "~/lib/pipe-system";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

/** Company standards: the pipe, fittings and valves each system is built from. */
export function PipeStandardsSection() {
  const specs = api.pipeSpecs.list.useQuery(undefined, { staleTime: 30_000 });
  const materials = api.catalogue.getMaterials.useQuery(undefined, { staleTime: 5 * 60_000 });
  const [open, setOpen] = useState<string | null>(null);
  const [extra, setExtra] = useState<string[]>([]);
  const [newCode, setNewCode] = useState("");
  if (specs.isLoading)
    return (
      <div className="bg-card rounded-2xl border p-6">
        <FormSkeleton label="Loading pipe standards" />
      </div>
    );
  if (!specs.data)
    return <div className="bg-card text-muted-foreground rounded-2xl border p-6 text-center text-sm">{specs.error?.message ?? "Could not load pipe standards."}</div>;
  const saved = new Map(specs.data.company.map((row) => [row.system, row]));
  const codes = [...new Set([...Object.keys(PIPE_SYSTEM_NAMES), ...saved.keys(), ...extra])];
  const materialName = (id: string | null) => (id ? materials.data?.find((material) => material.id === id)?.name ?? "Saved material" : null);
  const summary = (spec: PipeSpec) =>
    [
      `Pipe: ${materialName(spec.pipe.materialId) ?? "any"}, ${spec.pipe.stickLength} ${spec.pipe.stickUnit} sticks, ${spec.pipe.wastePercent}% waste`,
      `Fittings: ${materialName(spec.fittings.materialId) ?? "any"}`,
      `Valves: ${materialName(spec.valves.materialId) ?? "any"}`,
    ].join(" · ");
  const parsedCode = pipeSystemCode.safeParse(newCode);
  const canEdit = specs.data.canEditCompany;
  return (
    <div className="bg-card rounded-2xl border shadow-sm">
      <div className="space-y-1 border-b p-4">
        <h2 className="font-semibold">Pipe systems</h2>
        <p className="text-muted-foreground text-sm">
          Choose the catalogue material and category each system’s pipe, fittings and valves come from. Making a material list from a drawn system uses
          these; a job can override them.
        </p>
      </div>
      <ul className="divide-y">
        {codes.map((code) => {
          const row = saved.get(code);
          const expanded = open === code;
          return (
            <li key={code} className={cn(expanded && "bg-muted/30")}>
              <button
                type="button"
                className="hover:bg-accent flex w-full items-start gap-3 p-4 text-left disabled:cursor-default disabled:hover:bg-transparent"
                aria-expanded={expanded}
                disabled={!canEdit && !row}
                onClick={() => setOpen(expanded ? null : code)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {PIPE_SYSTEM_NAMES[code] ?? code} <span className="text-muted-foreground font-normal">({code})</span>
                  </span>
                  <span className="text-muted-foreground block text-xs">{row ? summary(row.spec) : "No standard — parts are matched by name and size."}</span>
                </span>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", row ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
                  {row ? "Set" : "Not set"}
                </span>
              </button>
              {expanded && (
                <div className="px-4 pb-4">
                  <PipeSpecEditor
                    key={row?.revision ?? 0}
                    system={code}
                    jobId={null}
                    spec={row?.spec ?? defaultPipeSpec()}
                    revision={row?.revision ?? 0}
                    saved={Boolean(row)}
                    onDone={() => setOpen(null)}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <form
          className="flex items-center gap-2 border-t p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!parsedCode.success) return;
            setExtra((value) => [...value, parsedCode.data]);
            setOpen(parsedCode.data);
            setNewCode("");
          }}
        >
          <Input aria-label="New system code" placeholder="Another system code, e.g. MG" className="h-9 max-w-64" maxLength={40} value={newCode} onChange={(event) => setNewCode(event.target.value)} />
          <Button size="sm" type="submit" variant="outline" disabled={!parsedCode.success}>
            <PlusIcon className="size-4" />
            Add system
          </Button>
        </form>
      )}
    </div>
  );
}
