"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "~/components/ui/dialog";
import type { SystemAlternative, SystemRule } from "~/lib/job-systems";
import {
  specMaterialCandidate,
  specMaterialRange,
} from "~/lib/spec-material-summary";
import { JobSystemEvidence } from "./JobSystemEvidence";
function Matches({
  rule,
  option,
}: {
  rule: SystemRule;
  option: SystemAlternative;
}) {
  const mapped = Boolean(
    option.materialId || option.categoryId || option.catalogId,
  );
  const parts = api.catalogue.searchParts.useQuery(
    {
      materialId: option.materialId ?? undefined,
      categoryId: option.categoryId,
      catalogId: option.catalogId ?? undefined,
      query: option.requiredTerms.join(" ") || undefined,
      limit: 200,
    },
    { enabled: mapped, staleTime: 60000 },
  );
  const candidates = (parts.data ?? []).filter((p) =>
    specMaterialCandidate(p, rule, option),
  );
  return (
    <div className="space-y-2 rounded border p-3">
      <p className="font-medium">{option.label}</p>
      <p className="text-muted-foreground text-sm">
        {[
          option.materialLabel,
          option.categoryLabel,
          option.catalogLabel,
          option.joining,
          ...option.requiredTerms,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {!mapped ? (
        <p>No catalogue mapping found. Review this requirement in Systems.</p>
      ) : parts.error ? (
        <p role="alert">
          Catalogue matches could not load: {parts.error.message}
        </p>
      ) : parts.isLoading ? (
        <p>Finding catalogue materials…</p>
      ) : (
        <>
          <p className="text-sm">
            {candidates.length
              ? "Potential catalogue matches — verify product details and joining requirements:"
              : "No matching catalogue parts found in the returned candidates. Review the mapping in Systems."}
          </p>
          <ul className="space-y-1 text-sm">
            {candidates.slice(0, 10).map((p) => (
              <li key={p.id}>
                {p.displayName}
                {p.sizeLabel ? ` · ${p.sizeLabel}` : ""}
              </li>
            ))}
          </ul>
          {(candidates.length > 10 || parts.data?.length === 200) && (
            <p className="text-muted-foreground text-xs">
              Showing up to 10 matches from the first 200 catalogue candidates.
              Use Systems to refine the selection.
            </p>
          )}
        </>
      )}
    </div>
  );
}
export function SuperSpecMaterialDialog({
  jobId,
  onClose,
}: {
  jobId: string;
  onClose: () => void;
}) {
  const utils = api.useUtils();
  const status = api.pipeSpecs.assessment.useQuery(
    { jobId },
    {
      refetchInterval: (q) =>
        q.state.data?.assessment?.status === "processing" ? 2500 : false,
    },
  );
  const systems = api.pipeSpecs.list.useQuery({ jobId });
  const start = api.pipeSpecs.assessSpecMaterials.useMutation();
  const [error, setError] = useState("");
  const assessment = status.data?.assessment;
  const busy = start.isPending || assessment?.status === "processing";
  const docs = (status.data?.documents ?? []).filter((d) => d.inSpecifications);
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    if (assessment?.status === "ready")
      void utils.pipeSpecs.list.invalidate({ jobId });
  }, [assessment?.runId, assessment?.status, jobId, utils]);
  async function assess() {
    setError("");
    try {
      await start.mutateAsync({ jobId });
      await status.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assessment could not start.");
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Super Spec Material</DialogTitle>
          <DialogDescription>
            Assess the documents in this job’s Specifications folder and its
            subfolders. Review allowable materials by system, source references
            and potential catalogue matches.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          Currently covers pipe, fittings, valves and joining requirements.
          Other specification scopes require manual review. Results remain
          proposals until reviewed in Systems.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !status.data?.canAssess || !docs.length}
            onClick={() => void assess()}
          >
            {busy ? "Assessing specifications…" : "Assess all specifications"}
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${jobId}/systems`}>
              Review in Systems
            </Link>
          </Button>
          {status.data?.folderId && (
            <Button asChild variant="outline">
              <Link
                href={`/jobs/${jobId}/documents?folder=${status.data.folderId}`}
              >
                Specifications folder
              </Link>
            </Button>
          )}
        </div>
        <details>
          <summary>{docs.length} accessible specification documents</summary>
          <ul className="text-sm">
            {docs.map((d) => (
              <li key={d.id}>{d.name}</li>
            ))}
          </ul>
        </details>
        {!status.isLoading && !docs.length && (
          <p>Add documents to the Specifications folder to begin.</p>
        )}
        {(error || status.error || systems.error) && (
          <p role="alert" className="text-destructive">
            {error || status.error?.message || systems.error?.message}
          </p>
        )}
        {busy && (
          <p role="status">
            {assessment?.stage ?? "Starting assessment…"} You can close this
            window and return later.
          </p>
        )}
        {assessment?.status === "failed" && (
          <p role="alert">
            Assessment failed: {assessment.error}. Existing saved results are
            shown below.
          </p>
        )}
        {assessment?.selection && (
          <p className="text-amber-600">
            The last assessment used a custom source selection. Use “Assess all
            specifications” for this tool’s full folder assessment.
          </p>
        )}
        {status.data?.stale && (
          <p className="text-amber-600">
            Sources have changed since the last assessment. Reassess before
            relying on these results.
          </p>
        )}
        {assessment?.warnings.map((w, i) => (
          <p className="text-sm text-amber-600" key={i}>
            {w}
          </p>
        ))}
        <p className="text-muted-foreground text-sm">
          {assessment?.completedAt
            ? `Last completed: ${new Date(assessment.completedAt).toLocaleString()}. `
            : ""}
          {systems.data?.job.length ?? 0} saved systems. Catalogue matches are
          suggestions, not confirmation of full specification compliance.
        </p>
        {systems.data?.job.map((row) => {
          const req = row.spec.requirements;
          const issues = req?.issues.filter((i) => !i.resolved) ?? [];
          const open = expanded === row.system;
          return (
            <section key={row.system} className="rounded-lg border p-3">
              <button
                className="w-full text-left font-semibold"
                aria-expanded={open}
                onClick={() => setExpanded(open ? null : row.system)}
              >
                {req?.systemName ?? row.system} · {row.system} —{" "}
                {req?.rules.length ?? 0} requirements · {issues.length} review
                issues
              </button>
              {open && (
                <div className="mt-3 space-y-4">
                  {issues.map((i, n) => (
                    <p key={n} className="text-sm text-amber-600">
                      {i.message}
                    </p>
                  ))}
                  {!req?.rules.length && (
                    <p>
                      No supported material requirements were extracted for this
                      system.
                    </p>
                  )}
                  {req?.rules.map((rule) => (
                    <div key={rule.id} className="space-y-2 border-t pt-3">
                      <h3 className="font-medium">
                        {rule.group}: {rule.label}
                      </h3>
                      <p className="text-sm">
                        {specMaterialRange(rule)} ·{" "}
                        {rule.reviewStatus === "approved"
                          ? "Reviewed"
                          : "Needs review"}
                      </p>
                      {!rule.alternatives.length && (
                        <p>
                          No allowable material identified; review the source.
                        </p>
                      )}
                      {rule.alternatives.map((option) => (
                        <Matches key={option.id} option={option} rule={rule} />
                      ))}
                      <JobSystemEvidence
                        jobId={jobId}
                        evidence={rule.evidence}
                      />
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
