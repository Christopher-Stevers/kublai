"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  FolderOpenIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { PageHeader } from "~/components/ui/page-header";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { confirmAction } from "~/components/ui/app-dialogs";
import type { AssessmentSelection } from "~/server/job-systems/types";
import { pipeSystemCode } from "~/lib/pipe-spec";
import { JobSystemsEditor, newManualSystemSpec } from "./JobSystemsEditor";

export function JobSystemsView({ jobId }: { jobId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const [system, setSystem] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [starting, setStarting] = useState(false);
  const [sourceChoice, setSourceChoice] = useState<{
    jobId: string;
    value: AssessmentSelection;
  } | null>(null);
  const [sourceSearch, setSourceSearch] = useState("");
  const previousRun = useRef<string | null>(null);
  const systems = api.pipeSpecs.list.useQuery({ jobId }, { staleTime: 30_000 });
  const status = api.pipeSpecs.assessment.useQuery(
    { jobId },
    {
      refetchInterval: (query) =>
        query.state.status !== "error" &&
        query.state.data?.assessment?.status === "processing"
          ? 2500
          : false,
    },
  );
  const assess = api.pipeSpecs.assess.useMutation();
  const folder = api.pipeSpecs.ensureSpecifications.useMutation();
  const save = api.pipeSpecs.save.useMutation();
  const assessment = status.data?.assessment;
  const running = starting || assessment?.status === "processing";
  const documents = status.data?.documents ?? [];
  const drawingSets = status.data?.drawingSets ?? [];
  const selection =
    sourceChoice?.jobId === jobId
      ? sourceChoice.value
      : (assessment?.selection ?? {
          documentIds: documents
            .filter((d) => d.inSpecifications !== false)
            .map((d) => d.id),
          drawingSetIds: [],
        });
  const choose = (
    kind: "documentIds" | "drawingSetIds",
    id: string,
    checked: boolean,
  ) => {
    setSourceChoice({
      jobId,
      value: {
        ...selection,
        [kind]: checked
          ? [...new Set([...selection[kind], id])]
          : selection[kind].filter((v) => v !== id),
      },
    });
  };
  const refreshSystems = async () => {
    await utils.pipeSpecs.list.invalidate({ jobId });
  };
  useEffect(() => {
    if (!assessment || assessment.status === "processing") return;
    if (previousRun.current !== `${assessment.runId}:${assessment.status}`)
      void utils.pipeSpecs.list.invalidate({ jobId });
    previousRun.current = `${assessment.runId}:${assessment.status}`;
  }, [assessment, jobId, utils]);
  const selected =
    systems.data?.job.find((row) => row.system === system) ??
    (system ? null : systems.data?.job[0]);
  if (!system && selected) setSystem(selected.system);
  const selectSystem = async (next: string) => {
    if (selected?.system === next) return;
    if (
      dirty &&
      !(await confirmAction({
        title: "Discard unsaved system changes?",
        confirmLabel: "Discard changes",
      }))
    )
      return;
    setDirty(false);
    setSystem(next);
  };
  const startAssessment = async () => {
    setError(null);
    setStarting(true);
    try {
      await assess.mutateAsync({ jobId, selection });
      await status.refetch();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Assessment could not start. Try again.",
      );
    } finally {
      setStarting(false);
    }
  };
  const openSpecifications = async () => {
    setError(null);
    try {
      const folderId =
        status.data?.folderId ?? (await folder.mutateAsync({ jobId })).folderId;
      router.push(
        `/dashboard/jobs/${jobId}/documents?folder=${encodeURIComponent(folderId)}`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open Specifications.",
      );
    }
  };
  const createSystem = async () => {
    const parsed = pipeSystemCode.safeParse(code);
    if (!parsed.success || !name.trim()) {
      setError(
        "Enter a system name and a code using letters, numbers, spaces or hyphens.",
      );
      return;
    }
    if (systems.data?.job.some((row) => row.system === parsed.data)) {
      setError(
        "That system code already exists for this job. Open it from the list instead.",
      );
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        jobId,
        system: parsed.data,
        revision: 0,
        spec: newManualSystemSpec(name.trim()),
      });
      await refreshSystems();
      setSystem(parsed.data);
      setNewOpen(false);
      setName("");
      setCode("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create this system.",
      );
    }
  };
  return (
    <div className="space-y-6">
      <PageHeader
        level="section"
        title="Systems"
        description="Use job documents and drawings to identify systems and review material requirements for takeoffs."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => void openSpecifications()}
              disabled={
                folder.isPending ||
                (!status.data?.folderId && !status.data?.canAssess)
              }
            >
              <FolderOpenIcon className="mr-2 size-4" />
              Specifications
            </Button>
            <Button
              onClick={() => void startAssessment()}
              disabled={
                running ||
                !status.data?.canAssess ||
                !status.data?.providerConfigured ||
                !(
                  selection.documentIds.length + selection.drawingSetIds.length
                ) ||
                dirty
              }
            >
              {running ? (
                <Loader2Icon className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="mr-2 size-4" />
              )}
              {running
                ? "Assessing…"
                : assessment
                  ? "Reassess Sources"
                  : "Assess Sources"}
            </Button>
          </div>
        }
      />
      <div className="space-y-2 text-sm">
        <p className="text-muted-foreground">
          Assessment runs only when requested. Review the results here; drawings
          use the selected job system’s approved rules.
        </p>
        {dirty && (
          <p className="text-amber-700 dark:text-amber-400">
            Save or discard your edits before reassessing.
          </p>
        )}
        {running && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-lg border p-3"
          >
            <Loader2Icon className="size-4 shrink-0 animate-spin" />
            <span>
              {assessment?.stage ?? "Starting source assessment…"} You can leave
              this page while it runs.
            </span>
          </div>
        )}
        {assessment?.status === "failed" && (
          <p role="alert" className="text-destructive rounded-lg border p-3">
            Assessment failed: {assessment.error ?? "Please try again."}{" "}
            Existing saved systems are retained.
          </p>
        )}
        {status.data?.stale && (
          <p className="flex gap-2 rounded-lg border border-amber-500/40 p-3 text-amber-700 dark:text-amber-400">
            <AlertTriangleIcon className="size-4 shrink-0" />
            Selected documents or drawings have changed. Reassess and review the
            affected requirements before using them.
          </p>
        )}
        {status.data && !status.data.providerConfigured && (
          <p className="rounded-lg border border-amber-500/40 p-3">
            AI assessment is not configured. You can add and review systems
            manually; an administrator must configure the assessment provider
            for automatic extraction.
          </p>
        )}
        {!!assessment?.warnings.length && (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer font-medium">
              Assessment notes ({assessment.warnings.length})
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {assessment.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </details>
        )}
        {error && !newOpen && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {(systems.error ?? status.error) && (
          <p role="alert" className="text-destructive">
            {systems.error?.message ?? status.error?.message}
            <Button
              variant="link"
              onClick={() => {
                void systems.refetch();
                void status.refetch();
              }}
            >
              Retry
            </Button>
          </p>
        )}
      </div>
      <details open className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Assessment sources · {selection.documentIds.length} documents ·{" "}
          {selection.drawingSetIds.length} drawing sets
        </summary>
        <p className="text-muted-foreground mt-2">
          Choose what to consider. Drawing notes, labels and legends provide
          clues; image-only symbols may need manual review. Selected text is
          sent to the assessment provider only when you press Assess Sources.
        </p>
        <Input
          aria-label="Filter assessment sources"
          className="mt-3"
          placeholder="Find a document or drawing set…"
          value={sourceSearch}
          onChange={(e) => setSourceSearch(e.target.value)}
        />
        <div className="my-3 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            onClick={() =>
              setSourceChoice({
                jobId,
                value: {
                  documentIds: documents
                    .filter((d) => d.inSpecifications !== false)
                    .map((d) => d.id),
                  drawingSetIds: [],
                },
              })
            }
          >
            Use Specifications folder
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={running}
            onClick={() =>
              setSourceChoice({
                jobId,
                value: { documentIds: [], drawingSetIds: [] },
              })
            }
          >
            Clear selection
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset disabled={running} className="min-w-0 space-y-2">
            <legend className="mb-2 font-medium">Documents</legend>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {documents
                .filter((d) =>
                  d.name.toLowerCase().includes(sourceSearch.toLowerCase()),
                )
                .map((document) => (
                  <label key={document.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Include document ${document.name}`}
                      checked={selection.documentIds.includes(document.id)}
                      onChange={(e) =>
                        choose("documentIds", document.id, e.target.checked)
                      }
                    />
                    <span className="min-w-0 break-words">
                      {document.name}
                      {document.inSpecifications && (
                        <span className="text-muted-foreground block text-xs">
                          Specifications
                        </span>
                      )}
                    </span>
                  </label>
                ))}
              {!documents.length && (
                <p className="text-muted-foreground">
                  No accessible uploaded documents yet.
                </p>
              )}
            </div>
          </fieldset>
          <fieldset disabled={running} className="min-w-0 space-y-2">
            <legend className="mb-2 font-medium">Drawing sets</legend>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {drawingSets
                .filter((s) =>
                  s.name.toLowerCase().includes(sourceSearch.toLowerCase()),
                )
                .map((set) => (
                  <label key={set.id} className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      aria-label={`Include drawing set ${set.name}`}
                      disabled={!set.sheetCount}
                      checked={selection.drawingSetIds.includes(set.id)}
                      onChange={(e) =>
                        choose("drawingSetIds", set.id, e.target.checked)
                      }
                    />
                    <span className="min-w-0 break-words">
                      {set.name}
                      <span className="text-muted-foreground block text-xs">
                        {set.sheetCount} current sheets
                      </span>
                    </span>
                  </label>
                ))}
              {!drawingSets.length && (
                <p className="text-muted-foreground">
                  No accessible drawing sets yet.
                </p>
              )}
            </div>
          </fieldset>
        </div>
      </details>
      {systems.isLoading && (
        <p role="status" className="text-muted-foreground">
          Loading job systems…
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Job systems" className="space-y-2">
          {systems.data?.job.map((row) => {
            const requirements = row.spec.requirements;
            const reviewCount =
              requirements?.rules.filter(
                (rule) => rule.reviewStatus !== "approved",
              ).length ?? 0;
            const issueCount =
              requirements?.issues.filter((issue) => !issue.resolved).length ??
              0;
            return (
              <button
                key={row.system}
                type="button"
                aria-current={
                  selected?.system === row.system ? "true" : undefined
                }
                className={`w-full rounded-lg border p-3 text-left ${selected?.system === row.system ? "border-primary bg-primary/10" : "hover:bg-muted/50"}`}
                onClick={() => void selectSystem(row.system)}
              >
                <span className="block font-medium">
                  {requirements?.systemName ?? row.system}
                </span>
                <span className="text-muted-foreground text-xs">
                  {row.system} · {requirements?.rules.length ?? 0} requirements
                  {reviewCount > 0 ? ` · ${reviewCount} to review` : ""}
                  {issueCount > 0 ? ` · ${issueCount} issues` : ""}
                </span>
              </button>
            );
          })}
          {!systems.isLoading && !systems.data?.job.length && (
            <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
              No systems assessed for this job yet.
            </p>
          )}
          {systems.data?.canEditJob && (
            <Button
              variant="outline"
              className="w-full"
              disabled={dirty}
              onClick={() => {
                setError(null);
                setNewOpen(true);
              }}
            >
              <PlusIcon className="mr-1 size-4" />
              Add system manually
            </Button>
          )}
        </nav>
        {selected ? (
          <JobSystemsEditor
            key={selected.system}
            jobId={jobId}
            system={selected.system}
            initial={selected.spec}
            revision={selected.revision}
            canEdit={systems.data?.canEditJob ?? false}
            onSaved={() => void refreshSystems()}
            onDirty={setDirty}
          />
        ) : (
          <div className="text-muted-foreground space-y-2 py-4 text-sm">
            <p>1. Add the source documents to Specifications.</p>
            <p>
              2. Assess once to identify systems, size ranges and permitted
              materials.
            </p>
            <p>
              3. Review the evidence and catalogue mappings, then choose the job
              system when taking off a drawing.
            </p>
          </div>
        )}
      </div>
      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add job system</DialogTitle>
            <DialogDescription>
              Create a system manually when a specification needs interpretation
              or the source is missing.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-1 text-sm">
            System name
            <Input
              value={name}
              maxLength={240}
              placeholder="Heating water"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm">
            Code
            <Input
              value={code}
              maxLength={40}
              placeholder="HW"
              onChange={(event) => setCode(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => void createSystem()}
            >
              {save.isPending ? "Adding…" : "Add system"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
