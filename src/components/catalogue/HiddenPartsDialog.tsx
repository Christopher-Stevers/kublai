"use client";

import { useMemo, useState } from "react";
import { Eye } from "lucide-react";
import { useHiddenPartsMutations } from "~/hooks/use-hidden-parts-mutations";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { facetCount } from "~/lib/catalogue-facets";
import { formatSizeDimensions } from "~/lib/size-utils";
import {
  ruleMatches,
  type CatalogueHideCriteria,
  type CatalogueHideRule,
} from "~/lib/catalogue-hidden";

type Named = { id: string; name: string };
type Facet = {
  id?: string;
  count?: number;
  catalogId: string;
  materialId: string | null;
  sizeNominal: string | number | null;
  sizeUnit: string | null;
  categoryId: string | null;
};
export type HideSource = {
  catalogs: Named[];
  materials: Named[];
  categories: Named[];
  parts: Facet[];
  namedParts: Array<Facet & { id: string; displayName: string }>;
};
type Form = { catalogId: string; materialId: string; size: string; categoryId: string; partId: string };

/** Above this many matching parts, narrow the other choices before picking one. */
const PART_CHOICES = 300;
const sizeKey = (nominal: number, unit: string) => `${nominal}|${unit}`;

function criteriaOf(form: Form): CatalogueHideCriteria {
  const [nominal, unit] = form.size.split("|");
  return {
    ...(form.catalogId && { catalogId: form.catalogId }),
    ...(form.materialId && { materialId: form.materialId }),
    ...(form.size && unit && { size: { nominal: Number(nominal), unit } }),
    ...(form.categoryId && { categoryId: form.categoryId }),
    ...(form.partId && { partId: form.partId }),
  };
}

const countOf = (parts: Facet[]) => parts.reduce((sum, part) => sum + facetCount(part), 0);
const partsLabel = (count: number) => `${count} part${count === 1 ? "" : "s"}`;

/**
 * Hide parts from adding to material lists by any mix of catalogue, material,
 * size, category or one part, so the crew has fewer options to sift through.
 * The Catalogue still shows every part; removing a rule offers them again.
 */
export function HiddenPartsDialog({
  open,
  onOpenChange,
  source,
  rules,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: HideSource;
  rules: CatalogueHideRule[];
  initial: CatalogueHideCriteria;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Hide from material lists</DialogTitle>
          <DialogDescription>
            Hidden parts can&apos;t be chosen when adding parts to a material
            list. The Catalogue still shows every part. Choose any mix.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <HiddenPartsForm
            source={source}
            rules={rules}
            initial={initial}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function HiddenPartsForm({
  source,
  rules,
  initial,
}: {
  source: HideSource;
  rules: CatalogueHideRule[];
  initial: CatalogueHideCriteria;
}) {
  const [form, setForm] = useState<Form>(() => ({
    catalogId: initial.catalogId ?? "",
    materialId: initial.materialId ?? "",
    size: initial.size ? sizeKey(initial.size.nominal, initial.size.unit) : "",
    categoryId: initial.categoryId ?? "",
    partId: initial.partId ?? "",
  }));
  const { hide, show } = useHiddenPartsMutations(() => {
    setForm({ catalogId: "", materialId: "", size: "", categoryId: "", partId: "" });
  });

  // Each choice offers only what is left after the choices above it.
  const choices = useMemo(() => {
    const by = <T,>(parts: Facet[], key: (part: Facet) => T | null) => {
      const counts = new Map<T, number>();
      for (const part of parts) {
        const value = key(part);
        if (value !== null) counts.set(value, (counts.get(value) ?? 0) + facetCount(part));
      }
      return counts;
    };
    const named = (list: Named[], counts: Map<string, number>) =>
      list.filter((item) => counts.has(item.id)).map((item) => ({ value: item.id, label: item.name, count: counts.get(item.id)! }));
    const { catalogId, materialId, size, categoryId } = criteriaOf(form);
    const inCatalog = source.parts.filter((part) => ruleMatches({ catalogId }, part));
    const inMaterial = inCatalog.filter((part) => ruleMatches({ materialId }, part));
    const inSize = inMaterial.filter((part) => ruleMatches({ size }, part));
    const sizes = [...by(inMaterial, (part) =>
      part.sizeNominal === null || !part.sizeUnit ? null : sizeKey(Number(part.sizeNominal), part.sizeUnit),
    )]
      .map(([value, count]) => {
        const [nominal, unit] = value.split("|");
        return { value, nominal: Number(nominal), label: formatSizeDimensions(Number(nominal), unit), count };
      })
      .sort((a, b) => a.nominal - b.nominal || a.label.localeCompare(b.label));
    const criteria = { catalogId, materialId, size, categoryId };
    const namedParts = source.namedParts.filter((part) => ruleMatches(criteria, part));
    return {
      catalogs: named(source.catalogs, by(source.parts, (part) => part.catalogId)),
      materials: named(source.materials, by(inCatalog, (part) => part.materialId)),
      sizes,
      categories: named(source.categories, by(inSize, (part) => part.categoryId)),
      parts: namedParts.length <= PART_CHOICES
        ? namedParts
            .map((part) => ({ value: part.id, label: part.displayName, count: 1 }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
        : null,
    };
  }, [source, form]);

  const criteria = criteriaOf(form);
  const chosen = Object.keys(criteria).length > 0;
  const matching = chosen ? countOf(source.parts.filter((part) => ruleMatches(criteria, part))) : 0;
  const describe = (rule: CatalogueHideCriteria) =>
    [
      rule.catalogId && (source.catalogs.find((item) => item.id === rule.catalogId)?.name ?? "A removed catalogue"),
      rule.materialId && (source.materials.find((item) => item.id === rule.materialId)?.name ?? "A removed material"),
      rule.size && formatSizeDimensions(rule.size.nominal, rule.size.unit),
      rule.categoryId && (source.categories.find((item) => item.id === rule.categoryId)?.name ?? "A removed category"),
      rule.partId && (source.namedParts.find((item) => item.id === rule.partId)?.displayName ?? "One part"),
    ].filter(Boolean).join(" · ");

  // A later choice that no longer fits the earlier ones falls back to Any.
  const set = (key: keyof Form, value: string) => {
    const order: Array<keyof Form> = ["catalogId", "materialId", "size", "categoryId", "partId"];
    setForm((old) => {
      const next = { ...old, [key]: value };
      for (const later of order.slice(order.indexOf(key) + 1)) next[later] = "";
      return next;
    });
  };
  const field = (
    key: keyof Form,
    label: string,
    options: Array<{ value: string; label: string; count: number }> | null,
    any: string,
  ) => (
    <label className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-2 text-sm">
      {label}
      <select
        aria-label={label}
        value={form[key]}
        disabled={!options}
        onChange={(event) => set(key, event.target.value)}
        className="border-input bg-background h-10 min-w-0 rounded-md border px-2 disabled:opacity-60"
      >
        <option value="">{any}</option>
        {options?.map((option) => (
          <option key={option.value} value={option.value}>
            {key === "partId" ? option.label : `${option.label} (${option.count})`}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-5">
      <section className="space-y-2" aria-label="Choose parts to hide">
        {field("catalogId", "Catalogue", choices.catalogs, "Any catalogue")}
        {field("materialId", "Material", choices.materials, "Any material")}
        {field("size", "Size", choices.sizes, "Any size")}
        {field("categoryId", "Category", choices.categories, "Any category")}
        {field("partId", "Part", choices.parts, choices.parts ? "Every matching part" : "Narrow it down to pick one part")}
        <div className="flex items-center gap-3 pt-1">
          <p role="status" className="text-muted-foreground min-w-0 flex-1 text-sm">
            {chosen ? `Hides ${partsLabel(matching)}` : "Choose at least one thing to hide."}
          </p>
          <Button type="button" disabled={!chosen || hide.isPending} onClick={() => hide.mutate({ criteria })}>
            {hide.isPending ? "Hiding…" : "Hide"}
          </Button>
        </div>
      </section>

      <section className="space-y-2" aria-label="Hidden from lists">
        <h3 className="text-sm font-semibold">Hidden from lists</h3>
        {rules.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing is hidden.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rules.map((rule) => (
              <li key={rule.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block break-words">{describe(rule)}</span>
                  <span className="text-muted-foreground text-xs">
                    {partsLabel(countOf(source.parts.filter((part) => ruleMatches(rule, part))))}
                  </span>
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={`Unhide ${describe(rule)}`}
                  disabled={show.isPending}
                  onClick={() => show.mutate({ ruleId: rule.id })}
                >
                  <Eye className="h-4 w-4" />
                  Unhide
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
