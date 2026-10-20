"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2Icon, ListPlusIcon, Settings2Icon } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "~/components/ui/dialog";
import { useJobPricing } from "~/hooks/use-job-pricing";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { findPreferredJobPrice, indexJobPrices } from "~/lib/job-pricing";
import { PIPE_SYSTEM_NAMES } from "~/lib/pipe-system";
import { formatPipeSize, sizeKey, type PipeSize } from "~/lib/pipe-run-sizes";
import {
  chosenPart,
  defaultPipeSpec,
  lineQuantity,
  partOptions,
  pipeWithWaste,
  stickCount,
  takeoffLines,
  type PipeCataloguePart,
  type PipeSpec,
  type PipeTakeoff,
  type PipeTakeoffLine,
} from "~/lib/pipe-spec";
import { getMaterialListReplicache, requestMaterialListReplicacheSync } from "~/lib/replicache-material-list";
import { api } from "~/trpc/react";
import { PipeSpecEditor } from "./PipeSpecEditor";

const COMMON_SIZES: PipeSize[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12].map((nominal) => ({ unit: "in", nominal }));
const fieldClass = "bg-background h-9 min-w-0 rounded-md border px-2 text-sm disabled:opacity-60";
type Scope = "company" | "job";

const systemName = (code: string) => PIPE_SYSTEM_NAMES[code] ?? `${code} system`;
const formatLength = (meters: number, unit: "ft" | "m") =>
  unit === "ft" ? `${Math.round(meters / 0.3048).toLocaleString()} ft` : `${(Math.round(meters * 10) / 10).toLocaleString()} m`;

/** Combine runs of the same size, giving unsized pipe the size the user picked. */
function sizedTakeoff(takeoff: PipeTakeoff, unsizedAs: PipeSize | null): PipeTakeoff {
  const runs = new Map<string, PipeTakeoff["runs"][number]>();
  for (const run of takeoff.runs) {
    const size = run.size ?? unsizedAs;
    const key = size ? sizeKey(size) : "?";
    const merged = runs.get(key);
    if (merged) merged.meters = merged.meters == null || run.meters == null ? null : merged.meters + run.meters;
    else runs.set(key, { size, meters: run.meters });
  }
  return { ...takeoff, runs: [...runs.values()] };
}

function LineRow({
  line,
  options,
  part,
  quantity,
  included,
  spec,
  onPart,
  onQuantity,
  onIncluded,
}: {
  line: PipeTakeoffLine;
  options: PipeCataloguePart[];
  part: PipeCataloguePart | null;
  quantity: number;
  included: boolean;
  spec: PipeSpec;
  onPart: (id: string) => void;
  onQuantity: (value: number) => void;
  onIncluded: (value: boolean) => void;
}) {
  const detail =
    line.group === "pipe"
      ? `${formatLength(line.amount, spec.pipe.stickUnit)} drawn · ${formatLength(pipeWithWaste(line.amount, spec), spec.pipe.stickUnit)} with ${spec.pipe.wastePercent}% waste · ${stickCount(line, spec)} × ${spec.pipe.stickLength} ${spec.pipe.stickUnit} sticks`
      : `${Math.ceil(line.amount)} on the drawing`;
  return (
    <li className={`space-y-2 border-b py-3 last:border-0 ${included ? "" : "opacity-60"}`}>
      <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-1 size-4" checked={included} onChange={(event) => onIncluded(event.target.checked)} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{line.label}</span>
          <span className="text-muted-foreground block text-xs">{detail}</span>
        </span>
      </label>
      {included && (
        <div className="flex gap-2 pl-6">
          {options.length > 0 ? (
            <select aria-label={`Part for ${line.label}`} className={`${fieldClass} flex-1`} value={part?.id ?? ""} onChange={(event) => onPart(event.target.value)}>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.displayName}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-muted-foreground flex-1 self-center text-xs">
              No {line.size ? `${formatPipeSize(line.size)} ` : ""}part found under this system’s standard.
            </p>
          )}
          {part && (
            <Input
              aria-label={`Quantity for ${line.label}`}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              className="h-9 w-20 shrink-0"
              value={quantity}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (event.target.value !== "" && value >= 0) onQuantity(value);
              }}
            />
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Turn the selected pipe system into a new material list: pipe by size in
 * whole sticks, plus the fittings and valves found on the drawing, each
 * matched to a part under the system's material standard.
 */
export function PipeMaterialListDialog({
  open,
  onOpenChange,
  jobId,
  sheetName,
  takeoff,
  analyzingComponents = false,
  onFindComponents,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  sheetName: string;
  takeoff: PipeTakeoff | null;
  analyzingComponents?: boolean;
  onFindComponents?: () => void;
}) {
  const online = useOnlineStatus();
  const utils = api.useUtils();
  const [systemChoice, setSystemChoice] = useState("");
  const system = takeoff?.system?.length ? takeoff.system : systemChoice;
  const specs = api.pipeSpecs.list.useQuery({ jobId }, { enabled: open && online, staleTime: 30_000 });
  const companyRow = specs.data?.company.find((row) => row.system === system);
  const jobRow = specs.data?.job.find((row) => row.system === system);
  const spec = jobRow?.spec ?? companyRow?.spec ?? defaultPipeSpec();
  const [editing, setEditing] = useState<Scope | null>(null);
  const [unsizedKey, setUnsizedKey] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; name: string; count: number } | null>(null);
  const { data: me } = api.user.getMe.useQuery(undefined, { enabled: open && online });
  const { data: priceBook } = useJobPricing(open ? jobId : null);
  const priceIndex = useMemo(() => indexJobPrices(priceBook?.entries ?? []), [priceBook]);
  const rememberChoices = api.pipeSpecs.save.useMutation({ onSuccess: () => utils.pipeSpecs.list.invalidate() });

  const sizes = useMemo(() => {
    const seen = new Map(COMMON_SIZES.map((size) => [sizeKey(size), size]));
    for (const run of takeoff?.runs ?? []) if (run.size) seen.set(sizeKey(run.size), run.size);
    return [...seen.values()].sort((a, b) => (a.unit === b.unit ? a.nominal - b.nominal : a.unit === "in" ? -1 : 1));
  }, [takeoff]);
  const unsizedAs = sizes.find((size) => sizeKey(size) === unsizedKey) ?? null;
  const unsizedMeters = takeoff?.runs.find((run) => !run.size)?.meters ?? 0;
  const lines = useMemo(() => (takeoff ? takeoffLines(sizedTakeoff(takeoff, unsizedAs)) : []), [takeoff, unsizedAs]);

  const ready = open && online && Boolean(system) && specs.isSuccess;
  const rule = (group: "pipe" | "fittings" | "valves", fallback?: string) => ({
    materialId: spec[group].materialId ?? undefined,
    categoryId: spec[group].categoryId,
    // Without a standard, narrow by name so the whole catalogue isn't searched.
    query: spec[group].materialId || spec[group].categoryId ? undefined : fallback,
    limit: 5000,
  });
  const hasGroup = (group: string) => lines.some((line) => line.group === group);
  const pipeParts = api.catalogue.searchParts.useQuery(rule("pipe", "pipe"), { enabled: ready && hasGroup("pipe"), staleTime: 5 * 60_000 });
  const fittingParts = api.catalogue.searchParts.useQuery(rule("fittings"), { enabled: ready && hasGroup("fittings"), staleTime: 5 * 60_000 });
  const valveParts = api.catalogue.searchParts.useQuery(rule("valves", "valve"), { enabled: ready && hasGroup("valves"), staleTime: 5 * 60_000 });
  const pools = { pipe: pipeParts, fittings: fittingParts, valves: valveParts };
  const searching = lines.some((line) => pools[line.group].isLoading);

  const rows = lines.map((line) => {
    const pool: PipeCataloguePart[] = pools[line.group].data ?? [];
    const options = partOptions(line, pool).slice(0, 60);
    const pickedPart = picked[line.key] ? pool.find((part) => part.id === picked[line.key]) : undefined;
    const part = pickedPart ?? chosenPart(line, pool, spec);
    if (part && !options.some((option) => option.id === part.id)) options.unshift(part);
    const quantity = quantities[line.key] ?? (part ? lineQuantity(line, part, spec) : 0);
    return { line, options, part, quantity, included: !excluded.has(line.key) };
  });
  const toAdd = rows.filter((row) => row.included && row.part && row.quantity > 0);
  const listName = `${systemName(system)} – ${sheetName}`.slice(0, 200);
  const saveScope: Scope | null = jobRow && specs.data?.canEditJob ? "job" : specs.data?.canEditCompany ? "company" : specs.data?.canEditJob ? "job" : null;
  const unsavedChoices = Object.entries(picked).filter(([key, id]) => spec.parts[key] !== id);

  const reset = () => {
    setPicked({});
    setQuantities({});
    setExcluded(new Set());
    setCreated(null);
    setCreateError(null);
    setEditing(null);
  };

  const create = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      // One line per part, even when two drawn lines use the same part.
      const byPart = new Map<string, { part: PipeCataloguePart; quantity: number }>();
      for (const row of toAdd) {
        const entry = byPart.get(row.part!.id);
        if (entry) entry.quantity += row.quantity;
        else byPart.set(row.part!.id, { part: row.part!, quantity: row.quantity });
      }
      const items = await Promise.all(
        [...byPart.values()].map(async ({ part, quantity }) => {
          const offers = await utils.supplier.getSupplierPartsByPart.fetch({ partDefinitionId: part.id }).catch(() => []);
          const priced = findPreferredJobPrice(priceIndex, part.id);
          const offer = offers.find((option) => option.id === priced?.supplierPartId) ?? offers.find((option) => option.isPreferred) ?? offers[0] ?? null;
          const jobCost = offer ? findPreferredJobPrice(priceIndex, part.id, offer.supplierId, offer.id)?.unitCost : undefined;
          const cost = jobCost ?? offer?.lastKnownUnitCost ?? null;
          return { part, quantity, offer, cost };
        }),
      );
      const materialListId = crypto.randomUUID();
      const replicache = getMaterialListReplicache();
      await replicache.mutate.createMaterialList({ materialListId, jobId, name: listName });
      await Promise.all(
        items.map(({ part, quantity, offer, cost }) =>
          replicache.mutate.addItem({
            materialListId,
            itemId: crypto.randomUUID(),
            partDefinitionId: part.id,
            supplierPartId: offer?.id ?? null,
            supplierId: offer?.supplierId ?? null,
            quantity,
            unitCost: Number(cost ?? 0),
            partDefinitionSnapshot: {
              id: part.id,
              displayName: part.displayName,
              piecesPerPack: part.piecesPerPack ?? null,
              bulkUnit: part.bulkUnit ?? null,
              individualUnit: part.individualUnit ?? null,
              imageUrl: part.imageUrl ?? null,
              material: part.material ?? null,
            },
            supplierPartSnapshot: offer
              ? {
                  id: offer.id,
                  supplierId: offer.supplierId,
                  supplierSku: offer.supplierSku,
                  lastKnownUnitCost: cost == null ? null : String(cost),
                  packSize: offer.packSize ?? null,
                  supplier: offer.supplier,
                }
              : null,
            addedBySnapshot: me ? { id: me.id, name: me.name, email: me.email } : null,
          }),
        ),
      );
      requestMaterialListReplicacheSync(0, "push-pull");
      setCreated({ id: materialListId, name: listName, count: items.length });
    } catch (error) {
      console.error("Creating the pipe material list failed", error);
      setCreateError("Couldn't create the list. Try again.");
    } finally {
      setCreating(false);
    }
  };

  const editorScope = editing;
  const editorRow = editorScope === "job" ? jobRow : companyRow;
  const editorSpec = editorScope === "job" ? (jobRow ?? companyRow)?.spec : companyRow?.spec;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) reset();
        onOpenChange(value);
      }}
    >
      <DialogContent className="flex max-h-[88dvh] max-w-[calc(100%-1rem)] flex-col gap-3 p-4 sm:max-w-2xl">
        <div className="space-y-1 pr-7">
          <DialogTitle>Material list from pipe</DialogTitle>
          <DialogDescription>
            {system ? `${systemName(system)} on ${sheetName}` : `Selected pipe on ${sheetName}`}. Check each part and quantity, then create a new list.
          </DialogDescription>
        </div>

        {created ? (
          <div className="space-y-3 py-6 text-center">
            <CheckCircle2Icon className="text-primary mx-auto size-10" />
            <p className="font-medium">
              Created {created.name} with {created.count} part{created.count === 1 ? "" : "s"}.
            </p>
            <div className="flex justify-center gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Back to drawing
              </Button>
              <Button asChild>
                <Link href={`/dashboard/material-lists/${created.id}`}>Open list</Link>
              </Button>
            </div>
          </div>
        ) : !takeoff ? (
          <p className="text-muted-foreground py-4 text-sm">Select a pipe system on the drawing first.</p>
        ) : !online ? (
          <p className="text-muted-foreground py-4 text-sm">Building a list from pipe needs an internet connection to read the catalogue.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 border-y py-2 text-sm">
              {!takeoff.system && (
                <select aria-label="Pipe system" className={fieldClass} value={systemChoice} onChange={(event) => setSystemChoice(event.target.value)}>
                  <option value="">Choose the system…</option>
                  {Object.entries(PIPE_SYSTEM_NAMES).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name} ({code})
                    </option>
                  ))}
                </select>
              )}
              {system && (
                <p className="text-muted-foreground min-w-0 flex-1 text-xs">
                  {specs.isLoading
                    ? "Loading standard…"
                    : jobRow
                      ? "Using this job’s standard"
                      : companyRow
                        ? "Using the company standard"
                        : "No standard set for this system — parts are matched by name and size."}
                </p>
              )}
              {system && specs.data && (specs.data.canEditCompany || specs.data.canEditJob) && (
                <Button
                  size="sm"
                  variant={editing ? "secondary" : "outline"}
                  className="h-8"
                  onClick={() => setEditing(editing ? null : jobRow ?? !specs.data?.canEditCompany ? "job" : "company")}
                >
                  <Settings2Icon className="size-4" />
                  Standard
                </Button>
              )}
            </div>

            {specs.error && (
              <p role="alert" className="text-destructive text-sm">
                {specs.error.message}
              </p>
            )}

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain">
              {editing && specs.data && (
                <div className="bg-muted/40 space-y-3 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="flex-1 text-sm font-semibold">{systemName(system)} standard</p>
                    <div role="group" aria-label="Standard for" className="bg-muted flex rounded-full p-0.5">
                      {(["company", "job"] as const).map((scope) => (
                        <button
                          key={scope}
                          type="button"
                          aria-pressed={editing === scope}
                          disabled={scope === "company" ? !specs.data?.canEditCompany : !specs.data?.canEditJob}
                          className={`h-7 rounded-full px-3 text-xs font-medium disabled:opacity-40 ${editing === scope ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                          onClick={() => setEditing(scope)}
                        >
                          {scope === "company" ? "Company" : "This job"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <PipeSpecEditor
                    key={`${editing}:${editorRow?.revision ?? 0}`}
                    system={system}
                    jobId={editing === "job" ? jobId : null}
                    spec={editorSpec ?? defaultPipeSpec()}
                    revision={editorRow?.revision ?? 0}
                    saved={Boolean(editorRow)}
                    onDone={() => {
                      setEditing(null);
                      setPicked({});
                      setQuantities({});
                    }}
                  />
                </div>
              )}

              {!system ? (
                <p className="text-muted-foreground py-2 text-sm">Choose which system this pipe belongs to.</p>
              ) : (
                <>
                  <div className="space-y-1 text-xs">
                    {takeoff.partial && <p className="text-amber-700">Only part of the system is selected; the list covers just that part.</p>}
                    {takeoff.runs.some((run) => run.meters == null) && <p className="text-amber-700">Set this sheet’s scale to include pipe lengths.</p>}
                    {unsizedMeters != null && unsizedMeters > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-amber-700">
                        <span>{formatLength(unsizedMeters, spec.pipe.stickUnit)} of pipe has no size tag nearby.</span>
                        <select aria-label="Size for untagged pipe" className={`${fieldClass} h-8 text-xs`} value={unsizedKey} onChange={(event) => setUnsizedKey(event.target.value)}>
                          <option value="">Leave it off</option>
                          {sizes.map((size) => (
                            <option key={sizeKey(size)} value={sizeKey(size)}>
                              Count it as {formatPipeSize(size)}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {!takeoff.componentsChecked && (
                      <div className="text-muted-foreground flex flex-wrap items-center gap-2">
                        <span>{analyzingComponents ? "Identifying fittings and valves…" : "Fittings and valves haven’t been identified for this selection."}</span>
                        {onFindComponents && !analyzingComponents && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onFindComponents}>
                            Find fittings
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                  {lines.length === 0 ? (
                    <p className="text-muted-foreground py-2 text-sm">Nothing to list yet. Pipe needs a size and a sheet scale; fittings need identifying.</p>
                  ) : (
                    <ul aria-busy={searching}>
                      {rows.map((row) => (
                        <LineRow
                          key={row.line.key}
                          {...row}
                          spec={spec}
                          onPart={(id) => {
                            setPicked((value) => ({ ...value, [row.line.key]: id }));
                            setQuantities(({ [row.line.key]: _, ...rest }) => rest);
                          }}
                          onQuantity={(value) => setQuantities((current) => ({ ...current, [row.line.key]: value }))}
                          onIncluded={(value) =>
                            setExcluded((current) => {
                              const next = new Set(current);
                              if (value) next.delete(row.line.key);
                              else next.add(row.line.key);
                              return next;
                            })
                          }
                        />
                      ))}
                    </ul>
                  )}
                  {searching && <p role="status" className="text-muted-foreground text-xs">Finding parts…</p>}
                </>
              )}
            </div>

            {(createError ?? rememberChoices.error) && (
              <p role="alert" className="text-destructive text-sm">
                {createError ?? rememberChoices.error?.message}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              {saveScope && unsavedChoices.length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rememberChoices.isPending}
                  title={saveScope === "job" ? "Use these parts next time on this job" : "Use these parts next time for this system"}
                  onClick={() => {
                    const row = saveScope === "job" ? jobRow : companyRow;
                    const base = saveScope === "job" ? (jobRow ?? companyRow)?.spec ?? spec : companyRow?.spec ?? spec;
                    rememberChoices.mutate(
                      { system, jobId: saveScope === "job" ? jobId : null, spec: { ...base, parts: { ...base.parts, ...picked } }, revision: row?.revision ?? 0 },
                      { onSuccess: () => setPicked({}) },
                    );
                  }}
                >
                  Remember {unsavedChoices.length} choice{unsavedChoices.length === 1 ? "" : "s"}
                </Button>
              )}
              <span className="flex-1" />
              {specs.data && !specs.data.canEditJob && <p className="text-muted-foreground text-xs">You need permission to edit this job’s lists.</p>}
              <Button
                disabled={!system || creating || searching || toAdd.length === 0 || !specs.data?.canEditJob}
                onClick={() => void create()}
              >
                <ListPlusIcon className="size-4" />
                {creating ? "Creating…" : `Create list (${toAdd.length})`}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
