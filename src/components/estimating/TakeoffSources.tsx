"use client";

import { SupplierLabel } from "~/components/suppliers/SupplierLabel";
import { useState } from "react";
import Link from "next/link";
import { ExternalLinkIcon, PlusIcon, SearchIcon } from "lucide-react";
import { api } from "~/trpc/react";
import type {
  EstimateAssembly,
  EstimateDocument,
  EstimateLine,
} from "~/lib/estimating";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import type { EstimateSheet } from "./EstimateLines";
import { normalizeUnit } from "~/lib/estimating";
import { actionClass, money, NumberInput } from "./estimating-ui";

export type TakeoffProgress = {
  completed: number;
  total: number;
  running: boolean;
  cancelled: boolean;
};
export function TakeoffSources({
  open,
  onOpenChange,
  document,
  jobId,
  sheets,
  materialLists,
  prefabs,
  disabled,
  canDrawings,
  onChange,
  onAddLines,
  onMaterialList,
  onPrefab,
  onAnalyze,
  progress,
  onCancel,
  assignmentLine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: EstimateDocument;
  jobId: string;
  sheets: EstimateSheet[];
  materialLists: { id: string; name: string }[];
  prefabs: { id: string; name: string }[];
  disabled: boolean;
  canDrawings: boolean;
  onChange: (document: EstimateDocument) => void;
  onAddLines: (lines: EstimateLine[]) => void;
  onMaterialList: (id: string) => void;
  onPrefab: (id: string, quantity: number) => void;
  onAnalyze: (ids: string[], includeRooms: boolean) => void;
  progress: TakeoffProgress | null;
  onCancel: () => void;
  assignmentLine?: EstimateLine;
}) {
  const [tab, setTab] = useState<
    "drawings" | "catalogue" | "lists" | "assemblies"
  >("drawings");
  const activeTab = assignmentLine ? "catalogue" : tab;
  const [search, setSearch] = useState("");
  const [catalogueQuantity, setCatalogueQuantity] = useState(1);
  const [assemblyQuantity, setAssemblyQuantity] = useState(1);
  const [prefabQuantity, setPrefabQuantity] = useState(1);
  const [includeRooms, setIncludeRooms] = useState(false);
  const catalogue = api.estimating.catalogue.useQuery(
    { search, limit: 40 },
    { enabled: open && activeTab === "catalogue" && search.trim().length >= 2 },
  );
  const pricebook = api.estimating.pricing.useQuery(undefined, {
    enabled: open && activeTab === "assemblies",
  });
  const addAssembly = (assembly: EstimateAssembly) =>
    onAddLines(
      assembly.lines.map((line) => ({
        ...line,
        id: crypto.randomUUID(),
        multiplier: line.multiplier * assemblyQuantity,
        alternateId: null,
        source: {
          kind: "assembly",
          label: `${assembly.name} × ${assemblyQuantity}`,
          evidence: assembly.description || undefined,
        },
      })),
    );
  const selected = document.selectedSheetIds;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88svh] min-w-0 overflow-y-auto p-4 sm:max-w-4xl sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {assignmentLine
              ? `Assign material — ${assignmentLine.description}`
              : "Add takeoff"}
          </DialogTitle>
          <DialogDescription>
            Use existing job evidence and organization resources. Drawing
            quantities require review before approval.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1 border-b pb-3">
          {(assignmentLine
            ? (["catalogue"] as const)
            : (["drawings", "catalogue", "lists", "assemblies"] as const)
          ).map((value) => (
            <Button
              key={value}
              variant={activeTab === value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setTab(value)}
            >
              {value === "drawings"
                ? "Job drawings"
                : value === "catalogue"
                  ? "Catalogue"
                  : value === "lists"
                    ? "Material lists & prefabs"
                    : "Custom assemblies"}
            </Button>
          ))}
        </div>
        {activeTab === "drawings" && (
          <div className="space-y-4">
            {!canDrawings ? (
              <p className="text-muted-foreground py-6 text-sm">
                Drawing access is required to select and analyze sheets.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-muted-foreground text-xs">
                    {
                      selected.filter((id) =>
                        sheets.some((sheet) => sheet.id === id),
                      ).length
                    }{" "}
                    of {sheets.length} sheets selected
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...document,
                          selectedSheetIds: sheets.map((sheet) => sheet.id),
                        })
                      }
                    >
                      Select all
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() =>
                        onChange({ ...document, selectedSheetIds: [] })
                      }
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="max-h-80 overflow-auto rounded border">
                  <div className="divide-y">
                    {sheets.map((sheet) => (
                      <label
                        key={sheet.id}
                        className="hover:bg-muted/40 grid min-w-0 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-3 text-sm sm:flex"
                      >
                        <input
                          type="checkbox"
                          checked={selected.includes(sheet.id)}
                          disabled={disabled}
                          onChange={() =>
                            onChange({
                              ...document,
                              selectedSheetIds: selected.includes(sheet.id)
                                ? selected.filter((id) => id !== sheet.id)
                                : [...selected, sheet.id],
                            })
                          }
                        />
                        <span className="min-w-0 font-medium break-words sm:min-w-16">
                          {sheet.number || `Page ${sheet.pageNumber}`}
                        </span>
                        <span className="text-muted-foreground col-start-2 min-w-0 flex-1 break-words">
                          {sheet.title}
                        </span>
                        {sheet.revision && (
                          <span className="text-muted-foreground col-start-2 text-xs break-words">
                            Rev {sheet.revision}
                          </span>
                        )}
                        <Link
                          href={`/dashboard/jobs/${jobId}/drawings?drawingSheet=${sheet.id}${sheet.setId ? `&drawingSet=${sheet.setId}` : ""}`}
                          aria-label={`Open drawing ${sheet.number || sheet.title}`}
                          onClick={(event) => event.stopPropagation()}
                          className="hover:bg-muted col-start-3 row-span-3 row-start-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded sm:h-8 sm:w-8"
                        >
                          <ExternalLinkIcon className="h-4 w-4" />
                        </Link>
                      </label>
                    ))}
                  </div>
                  {!sheets.length && (
                    <p className="text-muted-foreground p-10 text-center text-sm">
                      This job has no accepted drawing sheets. Upload drawings
                      in the job workspace first.
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={includeRooms}
                    disabled={disabled}
                    onChange={(event) => setIncludeRooms(event.target.checked)}
                  />
                  Include active room counts as unreviewed allowances
                </label>
                <p className="text-muted-foreground text-xs">
                  Imports saved measurements and explicitly counted schedule
                  rows. Room outlines and inferred scope are source evidence,
                  and require verification against the drawing.
                </p>
                <Button
                  className={actionClass}
                  disabled={
                    disabled ||
                    !selected.some((id) =>
                      sheets.some((sheet) => sheet.id === id),
                    )
                  }
                  onClick={() =>
                    onAnalyze(
                      selected.filter((id) =>
                        sheets.some((sheet) => sheet.id === id),
                      ),
                      includeRooms,
                    )
                  }
                >
                  {progress?.running ? "Analyzing…" : "Analyze selected sheets"}
                </Button>
              </>
            )}
            {progress && (
              <div
                role="status"
                aria-live="polite"
                className="bg-muted/30 space-y-2 rounded border p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span>
                    {progress.running
                      ? "Drawing takeoff in progress"
                      : progress.cancelled
                        ? "Stopped — completed results retained"
                        : "Drawing takeoff complete"}
                  </span>
                  {progress.running && (
                    <Button variant="outline" size="sm" onClick={onCancel}>
                      Stop after current batch
                    </Button>
                  )}
                </div>
                <progress
                  value={progress.completed}
                  max={progress.total || 1}
                  className="accent-primary h-2 w-full"
                />
                <p className="text-muted-foreground text-xs">
                  {progress.completed} / {progress.total} sheets imported.
                  Results are saved after each batch.
                </p>
                {!progress.running && (
                  <p className="text-muted-foreground text-xs">
                    Review source rows and the drawing limitations in Proposal
                    scope → Assumptions before approval.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
        {activeTab === "catalogue" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="text-muted-foreground absolute top-2.5 left-3 h-4 w-4" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search parts and supplier descriptions…"
                  aria-label="Search catalogue for takeoff"
                  className="pl-9"
                />
              </div>
              {!assignmentLine && (
                <div className="flex items-center gap-2 text-xs">
                  <span>Quantity</span>
                  <NumberInput
                    value={catalogueQuantity}
                    disabled={disabled}
                    className="w-24 border"
                    aria-label="Catalogue quantity"
                    onChange={(value) => setCatalogueQuantity(value ?? 0)}
                  />
                </div>
              )}
            </div>
            {catalogue.error && (
              <p role="alert" className="text-destructive text-sm">
                {catalogue.error.message}
              </p>
            )}
            <div className="max-h-96 divide-y overflow-auto">
              {catalogue.data?.map((line) => (
                <div key={line.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{line.description}</p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      <SupplierLabel name={line.supplierName} bookName="Standard" /> · {line.unit} ·{" "}
                      {line.materialUnitCost === null
                        ? "Price missing"
                        : `${money(line.materialUnitCost, document.settings.currency)} / ${line.unit}`}{" "}
                      · {line.priceSource}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      disabled ||
                      catalogueQuantity <= 0 ||
                      Boolean(
                        assignmentLine &&
                        normalizeUnit(assignmentLine.unit) !==
                          normalizeUnit(line.unit),
                      )
                    }
                    onClick={() =>
                      onAddLines([
                        {
                          ...line,
                          id: crypto.randomUUID(),
                          quantity: catalogueQuantity,
                          alternateId: null,
                        },
                      ])
                    }
                  >
                    <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                    {assignmentLine
                      ? normalizeUnit(assignmentLine.unit) ===
                        normalizeUnit(line.unit)
                        ? "Assign"
                        : `Needs ${assignmentLine.unit}`
                      : "Add"}
                  </Button>
                </div>
              ))}
            </div>
            {search.trim().length < 2 && (
              <p className="text-muted-foreground py-10 text-center text-sm">
                Enter at least two characters to find catalogue parts.
              </p>
            )}
            {catalogue.isFetching && (
              <p role="status" className="text-muted-foreground text-sm">
                Searching catalogue…
              </p>
            )}
            {search.trim().length >= 2 &&
              !catalogue.isFetching &&
              catalogue.data?.length === 0 && (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  No catalogue matches. Add a manual cost row for this scope.
                </p>
              )}
          </div>
        )}
        {activeTab === "lists" && (
          <div className="grid gap-6 sm:grid-cols-2">
            <section>
              <h3 className="mb-2 text-sm font-semibold">Job material lists</h3>
              <div className="divide-y">
                {materialLists.map((list) => (
                  <div
                    key={list.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0 flex-1 text-sm break-words">
                      {list.name}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => onMaterialList(list.id)}
                    >
                      Import
                    </Button>
                  </div>
                ))}
              </div>
              {!materialLists.length && (
                <p className="text-muted-foreground py-6 text-sm">
                  No material lists in this job.
                </p>
              )}
            </section>
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Prefabs</h3>
                <div className="flex items-center gap-1 text-xs">
                  <span>Quantity</span>
                  <NumberInput
                    aria-label="Prefab quantity"
                    className="w-20 border"
                    value={prefabQuantity}
                    disabled={disabled}
                    onChange={(value) => setPrefabQuantity(value ?? 0)}
                  />
                </div>
              </div>
              <div className="divide-y">
                {prefabs.map((prefab) => (
                  <div
                    key={prefab.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0 flex-1 text-sm break-words">
                      {prefab.name}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disabled || prefabQuantity <= 0}
                      onClick={() => onPrefab(prefab.id, prefabQuantity)}
                    >
                      Import
                    </Button>
                  </div>
                ))}
              </div>
              {!prefabs.length && (
                <p className="text-muted-foreground py-6 text-sm">
                  No organization prefabs available.
                </p>
              )}
            </section>
          </div>
        )}
        {activeTab === "assemblies" && (
          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Saved organization assemblies add their component costs.
              </p>
              <div className="flex items-center gap-1 text-xs">
                <span>Quantity</span>
                <NumberInput
                  aria-label="Assembly quantity"
                  className="w-24 border"
                  value={assemblyQuantity}
                  disabled={disabled}
                  onChange={(value) => setAssemblyQuantity(value ?? 0)}
                />
              </div>
            </div>
            {pricebook.error && (
              <p role="alert" className="text-destructive text-sm">
                {pricebook.error.message}
              </p>
            )}
            <div className="divide-y">
              {pricebook.data?.assemblies.map((assembly) => (
                <div key={assembly.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">
                      {assembly.name}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {assembly.lines.length} components per {assembly.unit}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disabled || assemblyQuantity <= 0}
                    onClick={() => addAssembly(assembly)}
                  >
                    Add assembly
                  </Button>
                </div>
              ))}
            </div>
            {pricebook.isLoading && (
              <p className="text-muted-foreground py-8 text-sm">
                Loading assemblies…
              </p>
            )}
            {pricebook.data?.assemblies.length === 0 && (
              <p className="text-muted-foreground py-8 text-sm">
                No custom assemblies. Select cost rows and use Save assembly to
                create one.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
