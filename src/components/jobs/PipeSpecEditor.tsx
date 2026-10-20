"use client";

import { useId, useState } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import type { PipeSpec, PipeSpecGroup } from "~/lib/pipe-spec";
import { api } from "~/trpc/react";

const GROUPS: { id: PipeSpecGroup; label: string; hint: string }[] = [
  { id: "pipe", label: "Pipe", hint: "Straight lengths" },
  { id: "fittings", label: "Fittings", hint: "Elbows, tees, wyes, couplings, caps" },
  { id: "valves", label: "Valves", hint: "Every valve type" },
];
const fieldClass = "bg-background h-9 w-full min-w-0 rounded-md border px-2 text-sm disabled:opacity-60";

function GroupRule({
  group,
  spec,
  disabled,
  onChange,
}: {
  group: (typeof GROUPS)[number];
  spec: PipeSpec;
  disabled: boolean;
  onChange: (spec: PipeSpec) => void;
}) {
  const id = useId();
  const rule = spec[group.id];
  const materials = api.catalogue.getMaterials.useQuery(undefined, { staleTime: 5 * 60_000 });
  const categoryQuery = api.catalogue.getCategories.useQuery(
    rule.materialId ? { materialId: rule.materialId } : undefined,
    { staleTime: 5 * 60_000 },
  );
  const categories = { data: categoryQuery.data as { categoryId: string; name: string; count: number }[] | undefined };
  const set = (patch: Partial<typeof rule>) => onChange({ ...spec, [group.id]: { ...rule, ...patch } });
  const knownCategory = !rule.categoryId || categories.data?.some((category) => category.categoryId === rule.categoryId);
  return (
    <fieldset className="space-y-2 rounded-lg border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-semibold">
        {group.label} <span className="text-muted-foreground text-xs font-normal">· {group.hint}</span>
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs" htmlFor={`${id}-material`}>
          <span className="text-muted-foreground">Material</span>
          <select
            id={`${id}-material`}
            className={fieldClass}
            value={rule.materialId ?? ""}
            onChange={(event) => set({ materialId: event.target.value || null, categoryId: null })}
          >
            <option value="">Any material</option>
            {materials.data?.map((material) => (
              <option key={material.id} value={material.id}>
                {material.groupPath?.length ? `${material.groupPath.join(" › ")} › ${material.name}` : material.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs" htmlFor={`${id}-category`}>
          <span className="text-muted-foreground">Category</span>
          <select
            id={`${id}-category`}
            className={fieldClass}
            value={rule.categoryId ?? ""}
            onChange={(event) => set({ categoryId: event.target.value || null })}
          >
            <option value="">Any category</option>
            {!knownCategory && <option value={rule.categoryId!}>Saved category (no parts here)</option>}
            {categories.data?.map((category) => (
              <option key={category.categoryId} value={category.categoryId}>
                {category.name} ({category.count})
              </option>
            ))}
          </select>
        </label>
      </div>
      {group.id === "pipe" && (
        <div className="grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] items-end gap-2">
          <label className="space-y-1 text-xs" htmlFor={`${id}-stick`}>
            <span className="text-muted-foreground">Stick length</span>
            <Input
              id={`${id}-stick`}
              type="number"
              inputMode="decimal"
              min={0.1}
              max={100}
              step="any"
              className="h-9"
              value={spec.pipe.stickLength}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (value > 0 && value <= 100) onChange({ ...spec, pipe: { ...spec.pipe, stickLength: value } });
              }}
            />
          </label>
          <select
            aria-label="Stick length unit"
            className={fieldClass}
            value={spec.pipe.stickUnit}
            onChange={(event) => onChange({ ...spec, pipe: { ...spec.pipe, stickUnit: event.target.value as "ft" | "m" } })}
          >
            <option value="ft">ft</option>
            <option value="m">m</option>
          </select>
          <label className="space-y-1 text-xs" htmlFor={`${id}-waste`}>
            <span className="text-muted-foreground">Waste %</span>
            <Input
              id={`${id}-waste`}
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step={1}
              className="h-9"
              value={spec.pipe.wastePercent}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (event.target.value !== "" && value >= 0 && value <= 100)
                  onChange({ ...spec, pipe: { ...spec.pipe, wastePercent: value } });
              }}
            />
          </label>
        </div>
      )}
    </fieldset>
  );
}

/** The material rules for one pipe system. */
export function PipeSpecFields({
  spec,
  disabled = false,
  onChange,
}: {
  spec: PipeSpec;
  disabled?: boolean;
  onChange: (spec: PipeSpec) => void;
}) {
  const chosen = Object.keys(spec.parts).length;
  return (
    <div className="space-y-3">
      {GROUPS.map((group) => (
        <GroupRule key={group.id} group={group} spec={spec} disabled={disabled} onChange={onChange} />
      ))}
      {chosen > 0 && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <p className="min-w-0 flex-1">
            {chosen} part choice{chosen === 1 ? "" : "s"} remembered for particular sizes.
          </p>
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={disabled} onClick={() => onChange({ ...spec, parts: {} })}>
            Forget
          </Button>
        </div>
      )}
    </div>
  );
}

/** Edit and save one system's standard, for the company or for one job. */
export function PipeSpecEditor({
  system,
  jobId,
  spec: initial,
  revision,
  saved,
  onDone,
}: {
  system: string;
  jobId: string | null;
  spec: PipeSpec;
  /** The stored revision this edit starts from; 0 when nothing is saved yet. */
  revision: number;
  /** A standard is stored at this scope and can be removed. */
  saved: boolean;
  onDone: (spec: PipeSpec | null) => void;
}) {
  const [spec, setSpec] = useState(initial);
  const utils = api.useUtils();
  const refresh = () => utils.pipeSpecs.list.invalidate();
  const save = api.pipeSpecs.save.useMutation({ onSuccess: refresh });
  const remove = api.pipeSpecs.remove.useMutation({ onSuccess: refresh });
  const busy = save.isPending || remove.isPending;
  const error = save.error?.message ?? remove.error?.message;
  return (
    <div className="space-y-3">
      <PipeSpecFields spec={spec} disabled={busy} onChange={setSpec} />
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {saved && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={busy}
            onClick={() => remove.mutate({ system, jobId }, { onSuccess: () => onDone(null) })}
          >
            {jobId ? "Use company standard" : "Remove standard"}
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onDone(initial)}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy} onClick={() => save.mutate({ system, jobId, spec, revision }, { onSuccess: () => onDone(spec) })}>
          {save.isPending ? "Saving…" : jobId ? "Save for this job" : "Save standard"}
        </Button>
      </div>
    </div>
  );
}
