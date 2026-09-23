"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { PartDetailsDialog } from "~/components/catalogue/PartDetailsDialog";
import { useOnlineStatus } from "~/hooks/use-online-status";
import type { AssistanceMode, Suggestion } from "~/server/assist/decisions";

const modes = [
  {
    id: "search",
    title: "Find materials",
    detail: "Search using trade names and abbreviations.",
    tab: "catalogue",
  },
  {
    id: "supplier",
    title: "Match supplier products",
    detail: "Compare a supplier listing with catalogue products.",
    tab: "suppliers",
  },
  {
    id: "catalogue",
    title: "Organize catalogue",
    detail: "Suggest a category and check for duplicate products.",
    tab: "catalogue",
  },
  {
    id: "materials",
    title: "Check a material list",
    detail: "Review product descriptions and units for conflicts.",
    tab: "dashboard",
  },
  {
    id: "sheets",
    title: "Classify a drawing",
    detail: "Identify plans, elevations, details, and schedules.",
    tab: "dashboard",
  },
  {
    id: "rooms",
    title: "Review room outlines",
    detail: "Prioritize unconfirmed outlines for visual inspection.",
    tab: "dashboard",
  },
] as const;

export function AssistancePanel() {
  const params = useSearchParams();
  const initial =
    modes.find((mode) => mode.id === params.get("mode"))?.id ?? "search";
  const [mode, setMode] = useState<AssistanceMode>(initial);
  const [id, setId] = useState(params.get("id") ?? "");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const [onlyReview, setOnlyReview] = useState(false);
  const [partId, setPartId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [hasRun, setHasRun] = useState(false);
  const online = useOnlineStatus();
  const status = api.assist.status.useQuery(undefined, {
    enabled: online,
    retry: false,
  });
  const role = api.user.getMyRole.useQuery(undefined, { enabled: online });
  const available = modes.filter(
    (item) =>
      role.data?.permissions.tabAccess[item.tab] &&
      (!(item.id === "supplier" || item.id === "materials") ||
        role.data?.permissions.tabAccess.catalogue),
  );
  const allowed = available.some((item) => item.id === mode);
  const sources = api.assist.sources.useQuery(
    { mode, search: debouncedSearch },
    { enabled: online && allowed && mode !== "search", retry: false },
  );
  const run = api.assist.run.useMutation();
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  function reset() {
    run.reset();
    setResults([]);
    setReviewed(new Set());
    setNextOffset(null);
    setHasRun(false);
    setNote("");
  }
  function changeMode(value: AssistanceMode) {
    setMode(value);
    setId("");
    setSearch("");
    setDebouncedSearch("");
    reset();
  }
  async function evaluate(offset = 0) {
    try {
      const response = await run.mutateAsync({
        mode,
        id: mode === "search" ? undefined : id,
        query: mode === "search" ? search : "",
        offset,
      });
      setResults((previous) =>
        offset
          ? [
              ...previous.filter(
                (p) => !response.results.some((r) => r.id === p.id),
              ),
              ...response.results,
            ]
          : response.results,
      );
      if (!offset) setReviewed(new Set());
      setNote(response.note);
      setNextOffset(response.nextOffset);
      setHasRun(true);
    } catch {
      /* Mutation error is displayed below; retain previous successful results. */
    }
  }
  const display = results
    .filter((result) => !onlyReview || result.priority === "review")
    .sort(
      (a, b) =>
        Number(reviewed.has(a.id)) - Number(reviewed.has(b.id)) ||
        (mode === "search"
          ? 0
          : Number(b.priority === "review") - Number(a.priority === "review")),
    );
  const pendingReview = results.filter(
    (r) => r.priority === "review" && !reviewed.has(r.id),
  ).length;
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold">AI assistance</h1>
        <p className="mt-2 text-gray-600">
          Find matches and review uncertain records. You stay in control of
          every change.
        </p>
      </div>
      {!online && (
        <p role="status" className="rounded-lg bg-amber-50 p-4">
          AI assistance needs an internet connection. Your regular offline tools
          are still available.
        </p>
      )}
      {status.error && (
        <p role="alert">
          Unable to check the AI connection.{" "}
          <button className="underline" onClick={() => void status.refetch()}>
            Retry
          </button>
        </p>
      )}
      {status.data && !status.data.configured && (
        <p
          role="status"
          className="rounded-lg border border-amber-300 bg-amber-50 p-4"
        >
          AI assistance is ready to connect. Your administrator needs to connect
          TypeSafe before suggestions can run.
        </p>
      )}
      <div
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Assistance tools"
      >
        {available.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={mode === item.id}
            disabled={run.isPending}
            onClick={() => changeMode(item.id)}
            className={`rounded-lg border p-4 text-left disabled:opacity-50 ${mode === item.id ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "bg-white hover:bg-gray-50"}`}
          >
            <span className="block font-semibold">{item.title}</span>
            <span className="mt-1 block text-sm text-gray-600">
              {item.detail}
            </span>
          </button>
        ))}
      </div>
      {role.data && !available.length && (
        <p>
          You do not have access to these tools. Ask your administrator to check
          your permissions.
        </p>
      )}
      {available.length > 0 && !allowed && (
        <p>Select one of the tools above to continue.</p>
      )}
      {allowed && (
        <section className="space-y-4 rounded-lg border bg-white p-4 sm:p-6">
          <h2 className="text-lg font-semibold">
            {modes.find((item) => item.id === mode)?.title}
          </h2>
          <label className="block space-y-2">
            <span className="text-sm font-medium">
              {mode === "search" ? "Describe the material" : "Find a record"}
            </span>
            <Input
              value={search}
              maxLength={mode === "search" ? 500 : 200}
              disabled={run.isPending}
              placeholder={
                mode === "search"
                  ? "e.g. 2 inch ABS DWV elbow"
                  : "Search by name…"
              }
              onChange={(event) => {
                setSearch(event.target.value);
                if (mode === "search") reset();
              }}
            />
          </label>
          {mode !== "search" && (
            <label className="block space-y-2">
              <span className="text-sm font-medium">
                {mode === "materials"
                  ? "Material list"
                  : mode === "rooms" || mode === "sheets"
                    ? "Drawing sheet"
                    : "Product"}
              </span>
              <select
                className="min-h-11 w-full rounded-md border bg-white p-2"
                value={id}
                disabled={run.isPending || sources.isLoading}
                onChange={(event) => {
                  setId(event.target.value);
                  reset();
                }}
              >
                <option value="">Choose a record…</option>
                {id && !sources.data?.some((source) => source.id === id) && (
                  <option value={id}>Selected record from previous page</option>
                )}
                {sources.data?.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label || "Unnamed record"}
                  </option>
                ))}
              </select>
              <span className="block text-xs text-gray-500">
                Showing up to 50 records. Search to narrow the list.
              </span>
            </label>
          )}
          {sources.error && mode !== "search" && (
            <p role="alert">
              Could not load records.{" "}
              <button
                className="underline"
                onClick={() => void sources.refetch()}
              >
                Retry
              </button>
            </p>
          )}
          <p className="text-sm text-gray-600">
            Running a check sends the selected product or drawing information to
            TypeSafe. Suggestions do not change your records.
          </p>
          <Button
            onClick={() => void evaluate()}
            disabled={
              !online ||
              !status.data?.configured ||
              run.isPending ||
              (mode === "search" ? search.trim().length < 2 : !id)
            }
          >
            {run.isPending ? "Checking…" : "Get suggestions"}
          </Button>
          {run.error && (
            <p role="alert" className="text-red-700">
              {run.error.message}
            </p>
          )}
        </section>
      )}
      {hasRun && (
        <section
          className="space-y-4"
          aria-label="Suggestions"
          aria-live="polite"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">
                {pendingReview} need closer review
              </h2>
              <p className="text-sm text-gray-600">{note}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={onlyReview}
                onChange={(event) => setOnlyReview(event.target.checked)}
              />
              Show only uncertain or flagged results
            </label>
          </div>
          {!display.length && (
            <p className="rounded-lg border bg-white p-4">
              {results.length
                ? "No results match this filter."
                : "No suggestions for this selection."}
            </p>
          )}
          {display.map((result) => (
            <article
              key={result.id}
              className={`space-y-3 rounded-lg border bg-white p-4 ${reviewed.has(result.id) ? "opacity-60" : ""}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="font-semibold">{result.title}</h3>
                <span
                  className={`rounded-full px-2 py-1 text-xs ${result.priority === "review" ? "bg-amber-100 text-amber-900" : "bg-blue-100 text-blue-900"}`}
                >
                  {reviewed.has(result.id)
                    ? "Reviewed"
                    : result.priority === "review"
                      ? "Review first"
                      : "Suggestion"}
                </span>
              </div>
              <p>{result.outcome}</p>
              <p className="text-sm text-gray-600">{result.reason}</p>
              <p className="text-xs text-gray-500">
                Model confidence: {Math.round(result.confidence * 100)}% ·
                Selected option probability:{" "}
                {Math.round(result.probability * 100)}%. These are model
                estimates, not verified accuracy.
              </p>
              <div className="flex flex-wrap gap-3">
                {result.partId && role.data?.permissions.canEditParts ? (
                  <Button
                    variant="outline"
                    onClick={() => setPartId(result.partId!)}
                  >
                    Review product
                  </Button>
                ) : (
                  <Link
                    href={result.href}
                    className="rounded-md border px-3 py-2 text-sm font-medium"
                  >
                    Open source record
                  </Link>
                )}
                <Button
                  variant="ghost"
                  onClick={() =>
                    setReviewed((previous) => {
                      const next = new Set(previous);
                      if (next.has(result.id)) next.delete(result.id);
                      else next.add(result.id);
                      return next;
                    })
                  }
                >
                  {reviewed.has(result.id)
                    ? "Mark for review"
                    : "Mark reviewed"}
                </Button>
              </div>
            </article>
          ))}
          {nextOffset !== null && (
            <Button
              variant="outline"
              disabled={!online || run.isPending}
              onClick={() => void evaluate(nextOffset)}
            >
              Check next 20 records
            </Button>
          )}
          <p className="text-xs text-gray-500">
            Review marks last for this visit. Changes are made through the
            source record’s normal editing controls.
          </p>
        </section>
      )}
      <PartDetailsDialog
        mode="edit"
        open={Boolean(partId)}
        partId={partId}
        onOpenChange={(open) => {
          if (!open) setPartId(null);
        }}
      />
    </div>
  );
}
