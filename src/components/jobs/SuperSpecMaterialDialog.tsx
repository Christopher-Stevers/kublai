"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { Input } from "~/components/ui/input";
import { serializeCsv } from "~/lib/estimating/csv";
import { downloadReport } from "~/lib/download-report";
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
  specMaterialReviewReasons,
} from "~/lib/spec-material-summary";
import { JobSystemEvidence, systemEvidenceHref } from "./JobSystemEvidence";
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
  const [findMatches, setFindMatches] = useState(false);
  const parts = api.catalogue.searchParts.useQuery(
    {
      materialId: option.materialId ?? undefined,
      categoryId: option.categoryId,
      catalogId: option.catalogId ?? undefined,
      query: option.requiredTerms.join(" ") || undefined,
      limit: 200,
    },
    { enabled: mapped && findMatches, staleTime: 60000 },
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
      ) : !findMatches ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFindMatches(true)}
        >
          Find catalogue matches
        </Button>
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
  const selectedStart = api.pipeSpecs.assess.useMutation();
  const [error, setError] = useState("");
  const assessment = status.data?.assessment;
  const busy =
    start.isPending ||
    selectedStart.isPending ||
    assessment?.status === "processing";
  const docs = (status.data?.documents ?? []).filter((d) => d.inSpecifications);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState("all");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [sourcePicker, setSourcePicker] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [selectedSets, setSelectedSets] = useState<string[]>([]);
  const allRows = systems.data?.job ?? [];
  const allRules = allRows.flatMap((row) => row.spec.requirements?.rules ?? []);
  const matchesSearch = (row: (typeof allRows)[number], rule?: SystemRule) =>
    `${row.system} ${row.spec.requirements?.systemName ?? ""} ${rule ? `${rule.label} ${rule.componentTerms.join(" ")} ${rule.alternatives.map((o) => [o.label, o.materialLabel, o.joining, ...o.requiredTerms].join(" ")).join(" ")}` : ""}`
      .toLowerCase()
      .includes(search.toLowerCase());
  const filteredRows = allRows
    .map((row) => ({
      ...row,
      filteredRules: (row.spec.requirements?.rules ?? []).filter(
        (rule) =>
          (group === "all" || rule.group === group) &&
          (!reviewOnly ||
            specMaterialReviewReasons(rule).length > 0 ||
            (row.spec.requirements?.issues.some(
              (i) => !i.resolved && (!i.ruleId || i.ruleId === rule.id),
            ) ??
              false)) &&
          matchesSearch(row, rule),
      ),
    }))
    .filter(
      (row) =>
        row.filteredRules.length > 0 ||
        (!row.spec.requirements?.rules.length &&
          matchesSearch(row) &&
          group === "all"),
    );
  function exportMaterials() {
    const records: (string | number)[][] = [
      [
        "Source status",
        status.data?.stale
          ? "Changed since assessment — reassess"
          : (assessment?.status ?? "Not assessed"),
      ],
      ["Assessment warnings", assessment?.warnings.join("; ") ?? ""],
      [
        "System",
        "Requirement",
        "Group",
        "Sizes",
        "Material",
        "Selected",
        "Joining",
        "Required terms",
        "Review",
        "Issues",
        "Source",
        "Evidence",
        "Source links",
      ],
    ];
    for (const row of filteredRows)
      for (const rule of row.filteredRules)
        for (const option of rule.alternatives.length
          ? rule.alternatives
          : [null])
          records.push([
            row.spec.requirements?.systemName ?? row.system,
            rule.label,
            rule.group,
            specMaterialRange(rule),
            option?.label ?? "No material identified",
            option?.id === rule.selectedAlternativeId ? "Yes" : "",
            option?.joining ?? "",
            option?.requiredTerms.join("; ") ?? "",
            rule.reviewStatus,
            [
              ...specMaterialReviewReasons(rule),
              ...(row.spec.requirements?.issues
                .filter(
                  (i) => !i.resolved && (!i.ruleId || i.ruleId === rule.id),
                )
                .map((i) => i.message) ?? []),
            ].join("; "),
            rule.evidence
              .map(
                (e) =>
                  `${e.documentTitle} p. ${e.page ?? "?"} ${e.section ?? ""}`,
              )
              .join("; "),
            rule.evidence.map((e) => e.quote).join("; "),
            rule.evidence
              .map(
                (e) =>
                  new URL(systemEvidenceHref(jobId, e), window.location.origin)
                    .href,
              )
              .join("; "),
          ]);
    downloadReport("super-spec-material.csv", serializeCsv(records));
  }
  async function assessSelection() {
    setError("");
    try {
      await selectedStart.mutateAsync({
        jobId,
        selection: { documentIds: selectedDocs, drawingSetIds: selectedSets },
      });
      await status.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assessment could not start.");
    }
  }
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
            Find material requirements across specifications and selected
            drawings. Compare size ranges, material choices, source evidence and
            catalogue matches by system.
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
          <Button
            variant="outline"
            disabled={busy || !status.data?.canAssess}
            onClick={() => {
              setSourcePicker(!sourcePicker);
              if (!sourcePicker) {
                setSelectedDocs(
                  assessment?.selection?.documentIds ??
                    docs.map((d) => d.id).slice(0, 20),
                );
                setSelectedSets(assessment?.selection?.drawingSetIds ?? []);
              }
            }}
          >
            Choose assessment sources
          </Button>
          <Button
            variant="outline"
            disabled={!filteredRows.some((row) => row.filteredRules.length)}
            onClick={exportMaterials}
          >
            Export material report
          </Button>
          <Button asChild variant="outline">
            <Link href={`/jobs/${jobId}/systems`}>Review in Systems</Link>
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
        {sourcePicker && (
          <div className="space-y-3 rounded border p-3">
            <p className="text-sm">
              Choose up to 20 documents and 50 drawing sets. Drawing notes,
              schedules and legends can supplement the specifications.
            </p>
            <div className="max-h-52 space-y-2 overflow-auto">
              {(status.data?.documents ?? []).map((doc) => (
                <label key={doc.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedDocs.includes(doc.id)}
                    disabled={
                      busy ||
                      (!selectedDocs.includes(doc.id) &&
                        selectedDocs.length >= 20)
                    }
                    onChange={(e) =>
                      setSelectedDocs((ids) =>
                        e.target.checked
                          ? [...ids, doc.id]
                          : ids.filter((id) => id !== doc.id),
                      )
                    }
                  />
                  {doc.name}
                </label>
              ))}
              {(status.data?.drawingSets ?? []).map((set) => (
                <label key={set.id} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSets.includes(set.id)}
                    disabled={
                      busy ||
                      (!selectedSets.includes(set.id) &&
                        selectedSets.length >= 50)
                    }
                    onChange={(e) =>
                      setSelectedSets((ids) =>
                        e.target.checked
                          ? [...ids, set.id]
                          : ids.filter((id) => id !== set.id),
                      )
                    }
                  />
                  {set.name} (drawing set)
                </label>
              ))}
            </div>
            <Button
              disabled={
                busy ||
                !status.data?.canAssess ||
                (!selectedDocs.length && !selectedSets.length)
              }
              onClick={() => void assessSelection()}
            >
              Assess selected sources
            </Button>
          </div>
        )}
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
            The last assessment used selected sources. Open “Choose assessment
            sources” to see or change them.
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
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded border p-3">
            <strong className="block text-2xl">{allRows.length}</strong>Systems
          </div>
          <div className="rounded border p-3">
            <strong className="block text-2xl">{allRules.length}</strong>
            Requirements
          </div>
          <div className="rounded border p-3">
            <strong className="block text-2xl">
              {
                allRules.filter(
                  (rule) => specMaterialReviewReasons(rule).length > 0,
                ).length
              }
            </strong>
            Need review
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            className="min-w-0 flex-1 basis-48"
            aria-label="Search material requirements"
            placeholder="System, material, joining or requirement"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="Material group"
            className="bg-background h-10 rounded border px-2"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          >
            <option value="all">All groups</option>
            {["pipe", "fittings", "valves", "joining"].map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reviewOnly}
              onChange={(e) => setReviewOnly(e.target.checked)}
            />
            Needs review only
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setExpanded(filteredRows.map((row) => row.system))}
          >
            Expand results
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded([])}>
            Collapse results
          </Button>
        </div>
        {systems.isLoading && (
          <p role="status">Loading material requirements…</p>
        )}
        {!systems.isLoading && !filteredRows.length && (
          <p className="py-5 text-center text-sm">
            {allRows.length
              ? "No requirements match these filters."
              : "Assess specifications or selected sources to build the material report."}
          </p>
        )}
        {filteredRows.map((row) => {
          const req = row.spec.requirements;
          const issues = req?.issues.filter((i) => !i.resolved) ?? [];
          const open = expanded.includes(row.system);
          return (
            <section key={row.system} className="rounded-lg border p-3">
              <button
                className="w-full text-left font-semibold"
                aria-expanded={open}
                onClick={() =>
                  setExpanded((current) =>
                    open
                      ? current.filter((id) => id !== row.system)
                      : [...current, row.system],
                  )
                }
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
                  {row.filteredRules.map((rule) => (
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
                      {specMaterialReviewReasons(rule).length > 0 && (
                        <p className="text-sm text-amber-600">
                          {specMaterialReviewReasons(rule).join(" · ")}
                        </p>
                      )}
                      {rule.componentTerms.length > 0 && (
                        <p className="text-sm">
                          Applies to: {rule.componentTerms.join(", ")}
                        </p>
                      )}
                      {rule.manualOverride && (
                        <p className="text-sm">
                          Manual override:{" "}
                          {rule.overrideReason ?? "Reviewed in Systems"}
                        </p>
                      )}
                      {!rule.alternatives.length && (
                        <p>
                          No allowable material identified; review the source.
                        </p>
                      )}
                      {rule.alternatives.map((option) => (
                        <div key={option.id}>
                          {rule.selectedAlternativeId === option.id && (
                            <p className="text-sm font-medium text-emerald-600">
                              Selected material
                            </p>
                          )}
                          <Matches option={option} rule={rule} />
                        </div>
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
