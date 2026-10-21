"use client";

import { useEffect, useId, useState } from "react";
import {
  AlertTriangleIcon,
  CheckIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { api } from "~/trpc/react";
import {
  defaultPipeSpec,
  pipeSpecSchema,
  type PipeSpec,
} from "~/lib/pipe-spec";
import {
  jobSystemRequirementsSchema,
  systemAlternativeSchema,
  systemRuleSchema,
  type JobSystemRequirements,
  type SystemAlternative,
  type SystemRule,
} from "~/lib/job-systems";
import { JobSystemEvidence } from "./JobSystemEvidence";

const fieldClass =
  "bg-background h-10 w-full min-w-0 rounded-md border px-2 text-sm disabled:opacity-60";
const textClass = "bg-background min-h-20 w-full rounded-md border p-2 text-sm";
const groups = {
  pipe: "Pipe",
  fittings: "Fittings",
  valves: "Valves",
  joining: "Joining",
};
const split = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

function CommaField({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(values.join(", "));
  if (split(text).join("\n") !== values.join("\n")) setText(values.join(", "));
  return (
    <Input
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(split(event.target.value));
      }}
    />
  );
}

function MaterialOption({
  value,
  onChange,
}: {
  value: SystemAlternative;
  onChange: (value: SystemAlternative) => void;
}) {
  const [preview, setPreview] = useState(false);
  const [size, setSize] = useState("");
  const [unit, setUnit] = useState("in");
  const id = useId();
  const materials = api.catalogue.getMaterials.useQuery(undefined, {
    staleTime: 300_000,
  });
  const catalogs = api.catalogue.getCatalogs.useQuery(undefined, {
    staleTime: 300_000,
  });
  const categories = api.catalogue.getCategories.useQuery(
    {
      materialId: value.materialId ?? undefined,
      catalogId: value.catalogId ?? undefined,
    },
    { staleTime: 300_000 },
  );
  const set = (patch: Partial<SystemAlternative>) =>
    onChange({ ...value, ...patch });
  const parts = api.catalogue.searchParts.useQuery(
    {
      materialId: value.materialId ?? undefined,
      categoryId: value.categoryId,
      catalogId: value.catalogId ?? undefined,
      query: value.requiredTerms.join(" ") || undefined,
      sizeNominal: Number(size) > 0 ? Number(size) : undefined,
      sizeUnit: Number(size) > 0 ? unit : undefined,
      limit: 50,
    },
    { enabled: preview, staleTime: 60_000 },
  );
  const categoryList = categories.data as
    | { categoryId: string; name: string }[]
    | undefined;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <label className="block space-y-1 text-xs">
        <span>Option name</span>
        <Input
          value={value.label}
          onChange={(event) => set({ label: event.target.value })}
          maxLength={240}
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="space-y-1 text-xs" htmlFor={`${id}-catalog`}>
          <span>Catalogue</span>
          <select
            id={`${id}-catalog`}
            className={fieldClass}
            value={value.catalogId ?? ""}
            onChange={(event) =>
              set({
                catalogId: event.target.value || null,
                catalogLabel:
                  catalogs.data?.find((item) => item.id === event.target.value)
                    ?.name ?? null,
                categoryId: null,
                categoryLabel: null,
              })
            }
          >
            <option value="">Any catalogue</option>
            {value.catalogId &&
              !catalogs.data?.some((item) => item.id === value.catalogId) && (
                <option value={value.catalogId}>
                  {value.catalogLabel ?? "Saved catalogue"}
                </option>
              )}
            {catalogs.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs" htmlFor={`${id}-material`}>
          <span>Material</span>
          <select
            id={`${id}-material`}
            className={fieldClass}
            value={value.materialId ?? ""}
            onChange={(event) =>
              set({
                materialId: event.target.value || null,
                materialLabel:
                  materials.data?.find((item) => item.id === event.target.value)
                    ?.name ?? null,
                categoryId: null,
                categoryLabel: null,
              })
            }
          >
            <option value="">Choose material</option>
            {value.materialId &&
              !materials.data?.some((item) => item.id === value.materialId) && (
                <option value={value.materialId}>
                  {value.materialLabel ?? "Saved material"}
                </option>
              )}
            {materials.data?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.groupPath?.length
                  ? `${item.groupPath.join(" › ")} › `
                  : ""}
                {item.name}
              </option>
            ))}
          </select>
          {!value.materialId && value.materialLabel && (
            <span className="text-amber-700 dark:text-amber-400">
              Specification: {value.materialLabel}; choose its catalogue
              mapping.
            </span>
          )}
        </label>
        <label className="space-y-1 text-xs" htmlFor={`${id}-category`}>
          <span>Category</span>
          <select
            id={`${id}-category`}
            className={fieldClass}
            value={value.categoryId ?? ""}
            onChange={(event) =>
              set({
                categoryId: event.target.value || null,
                categoryLabel:
                  categoryList?.find(
                    (item) => item.categoryId === event.target.value,
                  )?.name ?? null,
              })
            }
          >
            <option value="">Any category</option>
            {value.categoryId &&
              !categoryList?.some(
                (item) => item.categoryId === value.categoryId,
              ) && (
                <option value={value.categoryId}>
                  {value.categoryLabel ?? "Saved category"}
                </option>
              )}
            {categoryList?.map((item) => (
              <option key={item.categoryId} value={item.categoryId}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-xs">
        <span>Required catalogue terms (comma separated)</span>
        <CommaField
          placeholder="For example: Type L, Sch 40"
          values={value.requiredTerms}
          onChange={(requiredTerms) => set({ requiredTerms })}
        />
      </label>
      <label className="block space-y-1 text-xs">
        <span>Joining requirements</span>
        <textarea
          className={textClass}
          value={value.joining ?? ""}
          onChange={(event) => set({ joining: event.target.value || null })}
          maxLength={2000}
        />
      </label>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setPreview(!preview)}
      >
        {preview ? "Hide catalogue preview" : "Preview matching parts"}
      </Button>
      {preview && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex items-end gap-2">
            <label className="space-y-1 text-xs">
              <span>Filter by nominal size</span>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="All sizes"
                value={size}
                onChange={(event) => setSize(event.target.value)}
              />
            </label>
            <select
              className={`${fieldClass} w-24`}
              value={unit}
              aria-label="Preview size unit"
              onChange={(event) => setUnit(event.target.value)}
            >
              <option value="in">inches</option>
              <option value="mm">DN / mm</option>
            </select>
          </div>
          {parts.isLoading && (
            <p role="status" className="text-muted-foreground text-sm">
              Finding parts…
            </p>
          )}
          {parts.error && (
            <p role="alert" className="text-destructive text-sm">
              {parts.error.message}
            </p>
          )}
          {parts.data && (
            <>
              <p className="text-muted-foreground text-xs">
                {parts.data.length
                  ? `${parts.data.length === 50 ? "First " : ""}${parts.data.length} matching parts. Exact size and fitting type are applied during takeoff.`
                  : "No matching parts. Adjust the mapping or flag this requirement for review."}
              </p>
              <ul className="max-h-48 space-y-1 overflow-auto text-sm">
                {parts.data.map((part) => (
                  <li key={part.id} className="border-b py-1">
                    {part.displayName}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  jobId,
  rule,
  onChange,
  onDelete,
}: {
  jobId: string;
  rule: SystemRule;
  onChange: (rule: SystemRule) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(
    rule.origin === "manual" && rule.label === "New requirement",
  );
  const set = (patch: Partial<SystemRule>) =>
    onChange({ ...rule, ...patch, manualOverride: true });
  const setRange = (patch: Partial<SystemRule["sizeRange"]>) =>
    set({ sizeRange: { ...rule.sizeRange, ...patch } });
  return (
    <details className="rounded-lg border p-4" open={expanded}>
      <summary
        className="cursor-pointer list-none space-y-1"
        onClick={(event) => {
          event.preventDefault();
          setExpanded((value) => !value);
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium">{rule.label || "New requirement"}</span>
          <span
            className={`shrink-0 text-xs ${rule.reviewStatus === "approved" ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}
          >
            {rule.reviewStatus === "approved" ? "Reviewed" : "Needs review"}
          </span>
        </div>
        <p className="text-muted-foreground text-xs">
          {groups[rule.group]} ·{" "}
          {rule.sizeRange.min == null && rule.sizeRange.max == null
            ? "All sizes"
            : `${rule.sizeRange.min == null ? "Any" : `${rule.sizeRange.minInclusive ? "≥" : ">"} ${rule.sizeRange.min}`} to ${rule.sizeRange.max == null ? "any" : `${rule.sizeRange.maxInclusive ? "≤" : "<"} ${rule.sizeRange.max}`} ${rule.sizeRange.unit}`}{" "}
          · {rule.alternatives.length} permitted option
          {rule.alternatives.length === 1 ? "" : "s"}
          {rule.manualOverride && " · Your correction retained"}
        </p>
      </summary>
      {expanded && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
            <label className="space-y-1 text-xs">
              <span>Requirement</span>
              <Input
                value={rule.label}
                maxLength={240}
                onChange={(event) => set({ label: event.target.value })}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span>Component group</span>
              <select
                className={fieldClass}
                value={rule.group}
                onChange={(event) =>
                  set({ group: event.target.value as SystemRule["group"] })
                }
              >
                {Object.entries(groups).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1 text-xs">
              <label className="block space-y-1">
                <span>Minimum nominal size</span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="No minimum"
                  value={rule.sizeRange.min ?? ""}
                  onChange={(event) =>
                    setRange({
                      min:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.sizeRange.minInclusive}
                  onChange={(event) =>
                    setRange({ minInclusive: event.target.checked })
                  }
                />
                Include boundary
              </label>
            </div>
            <div className="space-y-1 text-xs">
              <label className="block space-y-1">
                <span>Maximum nominal size</span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="No maximum"
                  value={rule.sizeRange.max ?? ""}
                  onChange={(event) =>
                    setRange({
                      max:
                        event.target.value === ""
                          ? null
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={rule.sizeRange.maxInclusive}
                  onChange={(event) =>
                    setRange({ maxInclusive: event.target.checked })
                  }
                />
                Include boundary
              </label>
            </div>
            <label className="space-y-1 text-xs">
              <span>Size unit</span>
              <select
                className={fieldClass}
                value={rule.sizeRange.unit}
                onChange={(event) =>
                  setRange({ unit: event.target.value as "in" | "mm" })
                }
              >
                <option value="in">Nominal inches</option>
                <option value="mm">DN / millimetres</option>
              </select>
            </label>
          </div>
          <label className="block space-y-1 text-xs">
            <span>
              Applies to these component names (comma separated; blank means the
              whole group)
            </span>
            <CommaField
              values={rule.componentTerms}
              onChange={(componentTerms) => set({ componentTerms })}
            />
          </label>
          <label className="block space-y-1 text-xs">
            <span>Component types (comma separated; optional)</span>
            <CommaField
              values={rule.componentKinds}
              placeholder="For example: elbow, tee, valve"
              onChange={(componentKinds) => set({ componentKinds })}
            />
          </label>
          {rule.group === "joining" && (
            <fieldset className="rounded-md border p-3 text-sm">
              <legend className="px-1 text-xs">
                Apply joining requirements to
              </legend>
              <div className="flex flex-wrap gap-4">
                {(["pipe", "fittings", "valves"] as const).map((group) => (
                  <label key={group} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.appliesTo.includes(group)}
                      onChange={(event) =>
                        set({
                          appliesTo: event.target.checked
                            ? [...rule.appliesTo, group]
                            : rule.appliesTo.filter((item) => item !== group),
                        })
                      }
                    />
                    {groups[group]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <JobSystemEvidence jobId={jobId} evidence={rule.evidence} />
          <label className="block space-y-1 text-xs">
            <span>Material option to use for this job</span>
            <select
              className={fieldClass}
              value={rule.selectedAlternativeId ?? ""}
              onChange={(event) =>
                set({ selectedAlternativeId: event.target.value || null })
              }
            >
              <option value="">
                {rule.alternatives.length > 1
                  ? "Choose a permitted option"
                  : "Use the only permitted option"}
              </option>
              {rule.alternatives.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {rule.alternatives.map((option) => (
            <div key={option.id} className="space-y-1">
              <MaterialOption
                value={option}
                onChange={(next) =>
                  set({
                    alternatives: rule.alternatives.map((item) =>
                      item.id === next.id ? next : item,
                    ),
                  })
                }
              />
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() =>
                  set({
                    alternatives: rule.alternatives.filter(
                      (item) => item.id !== option.id,
                    ),
                    selectedAlternativeId:
                      rule.selectedAlternativeId === option.id
                        ? null
                        : rule.selectedAlternativeId,
                  })
                }
              >
                Remove option
              </Button>
            </div>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              set({
                alternatives: [
                  ...rule.alternatives,
                  systemAlternativeSchema.parse({
                    id: crypto.randomUUID(),
                    label: "New permitted option",
                  }),
                ],
              })
            }
          >
            <PlusIcon className="mr-1 size-4" />
            Add permitted option
          </Button>
          <label className="block space-y-1 text-xs">
            <span>Review / override notes</span>
            <textarea
              className={textClass}
              value={rule.overrideReason ?? ""}
              onChange={(event) =>
                set({ overrideReason: event.target.value || null })
              }
              maxLength={2000}
              placeholder="Explain any change to the source requirement."
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rule.reviewStatus === "approved"}
                onChange={(event) =>
                  set({
                    reviewStatus: event.target.checked ? "approved" : "pending",
                  })
                }
              />
              I reviewed this requirement
            </label>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={onDelete}
            >
              <Trash2Icon className="mr-1 size-4" />
              Remove requirement
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}

export function JobSystemsEditor({
  jobId,
  system,
  initial,
  revision,
  canEdit,
  onSaved,
  onDirty,
}: {
  jobId: string;
  system: string;
  initial: PipeSpec;
  revision: number;
  canEdit: boolean;
  onSaved: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = api.pipeSpecs.save.useMutation();
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  // Reconcile a new server revision only when there is no local draft.
  // Keep dirty edits and the original revision so a concurrent save is refused.
  if (!dirty && (draft !== initial || baseRevision !== revision)) {
    setDraft(initial);
    setBaseRevision(revision);
  }
  const requirements =
    draft.requirements ??
    jobSystemRequirementsSchema.parse({ systemName: system });
  const change = (next: JobSystemRequirements) => {
    setDraft({ ...draft, requirements: next });
    setDirty(true);
    setSaved(false);
    setError(null);
  };
  const unresolved = requirements.issues.filter((issue) => !issue.resolved);
  const submit = async () => {
    const parsed = pipeSpecSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(". "));
      return;
    }
    setError(null);
    try {
      await save.mutateAsync({
        jobId,
        system,
        spec: parsed.data,
        revision: baseRevision,
      });
      setDirty(false);
      setSaved(true);
      onSaved();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this system. Try again.",
      );
    }
  };
  return (
    <section
      className="min-w-0 space-y-4"
      aria-label={`${requirements.systemName} requirements`}
    >
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">{requirements.systemName}</h2>
        <p className="text-muted-foreground text-sm">
          Review source requirements and choose permitted materials. Saved
          corrections stay in place when specifications are reassessed.
        </p>
      </div>
      <JobSystemEvidence
        jobId={jobId}
        evidence={requirements.applicabilityEvidence}
        title="Why this system applies"
      />
      {revision !== baseRevision && dirty && (
        <p role="alert" className="text-amber-700 dark:text-amber-400">
          This system changed while you were editing. Your draft is still here;
          discard it to load the latest version before saving.
        </p>
      )}
      <fieldset
        className="space-y-4 disabled:opacity-70"
        disabled={!canEdit || save.isPending}
      >
        <label className="block space-y-1 text-xs">
          <span>System name</span>
          <Input
            value={requirements.systemName}
            maxLength={240}
            onChange={(event) =>
              change({
                ...requirements,
                systemName: event.target.value,
                manualName: true,
              })
            }
          />
        </label>
        {!!requirements.issues.length && (
          <div className="space-y-2 rounded-lg border border-amber-500/40 p-3">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangleIcon className="size-4" />
              {unresolved.length} unresolved issue
              {unresolved.length === 1 ? "" : "s"}
            </h3>
            {requirements.issues.map((issue, index) => (
              <label
                key={`${issue.code}:${index}`}
                className="flex items-start gap-2 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={issue.resolved}
                  onChange={(event) =>
                    change({
                      ...requirements,
                      issues: requirements.issues.map((item, itemIndex) =>
                        itemIndex === index
                          ? { ...item, resolved: event.target.checked }
                          : item,
                      ),
                    })
                  }
                />
                <span>
                  {issue.message}
                  <span className="text-muted-foreground block text-xs">
                    Check after you have resolved this
                    {issue.blocking ? "; it blocks affected takeoff rows" : ""}.
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
        {!requirements.rules.length && (
          <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
            No detailed requirements yet. Assess the specification documents or
            add a requirement below.
          </p>
        )}
        {requirements.rules.map((rule) => (
          <RuleEditor
            key={rule.id}
            jobId={jobId}
            rule={rule}
            onChange={(next) =>
              change({
                ...requirements,
                rules: requirements.rules.map((item) =>
                  item.id === next.id ? next : item,
                ),
              })
            }
            onDelete={() =>
              change({
                ...requirements,
                rules: requirements.rules.filter((item) => item.id !== rule.id),
                suppressedRuleIds: [
                  ...new Set([...requirements.suppressedRuleIds, rule.id]),
                ],
              })
            }
          />
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            change({
              ...requirements,
              rules: [
                ...requirements.rules,
                systemRuleSchema.parse({
                  id: `manual:${crypto.randomUUID()}`,
                  label: "New requirement",
                  group: "pipe",
                  origin: "manual",
                  manualOverride: true,
                }),
              ],
            })
          }
        >
          <PlusIcon className="mr-1 size-4" />
          Add requirement
        </Button>
        <details className="rounded-md border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Pipe quantities
          </summary>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <label className="text-xs">
              Stick length
              <Input
                type="number"
                min="0.1"
                max="100"
                step="any"
                value={draft.pipe.stickLength}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    pipe: {
                      ...draft.pipe,
                      stickLength: Number(event.target.value),
                    },
                  });
                  setDirty(true);
                }}
              />
            </label>
            <label className="text-xs">
              Unit
              <select
                className={fieldClass}
                value={draft.pipe.stickUnit}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    pipe: {
                      ...draft.pipe,
                      stickUnit: event.target.value as "ft" | "m",
                    },
                  });
                  setDirty(true);
                }}
              >
                <option value="ft">ft</option>
                <option value="m">m</option>
              </select>
            </label>
            <label className="text-xs">
              Waste %
              <Input
                type="number"
                min="0"
                max="100"
                value={draft.pipe.wastePercent}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    pipe: {
                      ...draft.pipe,
                      wastePercent: Number(event.target.value),
                    },
                  });
                  setDirty(true);
                }}
              />
            </label>
          </div>
        </details>
      </fieldset>
      {!canEdit && (
        <p className="text-muted-foreground text-sm">
          You can view this job’s systems. Editing requires material-list edit
          access.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {saved && !dirty && (
        <p
          role="status"
          className="flex items-center gap-1 text-sm text-green-700 dark:text-green-400"
        >
          <CheckIcon className="size-4" />
          System saved.
        </p>
      )}
      {canEdit && (
        <div className="bg-background sticky bottom-0 flex items-center gap-2 border-t py-3">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() => void submit()}
          >
            {save.isPending ? "Saving…" : "Save system"}
          </Button>
          <Button
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDirty(false);
              setError(null);
            }}
          >
            Discard changes
          </Button>
          {dirty && (
            <span className="text-muted-foreground text-xs">
              Unsaved changes
            </span>
          )}
        </div>
      )}
    </section>
  );
}

export function newManualSystemSpec(name: string): PipeSpec {
  return {
    ...defaultPipeSpec(),
    requirements: jobSystemRequirementsSchema.parse({
      systemName: name,
      manualName: true,
    }),
  };
}
