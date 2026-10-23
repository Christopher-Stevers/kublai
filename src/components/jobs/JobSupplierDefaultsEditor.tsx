"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  GripVerticalIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { useReplicacheCatalogue } from "~/hooks/use-replicache-catalogue";
import { useOnlineStatus } from "~/hooks/use-online-status";
import { api } from "~/trpc/react";
import {
  EMPTY_SUPPLIER_DEFAULTS,
  type JobSupplierDefaults,
  type SupplierDefaultRule,
  type SupplierVersion,
} from "~/lib/job-supplier-defaults";
const versionKey = (version: SupplierVersion) =>
  `${version.supplierId}:${version.bookId ?? "base"}`;
export function JobSupplierDefaultsEditor({
  jobId,
  value,
  onChange,
}: {
  jobId: string;
  value: JobSupplierDefaults | null;
  onChange: (next: JobSupplierDefaults) => void;
}) {
  const online = useOnlineStatus();
  const query = api.job.supplierDefaultOptions.useQuery(
    { jobId },
    { enabled: online },
  );
  const catalogue = useReplicacheCatalogue();
  const config = value ?? EMPTY_SUPPLIER_DEFAULTS;
  const [dragged, setDragged] = useState<string | null>(null);
  useEffect(() => {
    if (!value && query.data)
      onChange(query.data.defaults ?? EMPTY_SUPPLIER_DEFAULTS);
  }, [value, query.data, onChange]);
  const options = useMemo(() => {
    const map = new Map<string, SupplierVersion>();
    for (const option of [
      ...(query.data?.options ?? []),
      ...config.rules.map((rule) => rule.supplier),
      ...(config.fallback ? [config.fallback] : []),
    ])
      if (!map.has(versionKey(option))) map.set(versionKey(option), option);
    return [...map.values()];
  }, [query.data, config.rules, config.fallback]);
  const sizes = useMemo(() => {
    const map = new Map<
      string,
      { nominal: number; unit: string; label: string | null }
    >();
    for (const part of catalogue.parts)
      if (part.sizeNominal !== null && part.sizeUnit) {
        const size = {
          nominal: Number(part.sizeNominal),
          unit: part.sizeUnit,
          label: part.sizeLabel ?? null,
        };
        map.set(JSON.stringify(size), size);
      }
    return [...map].sort(
      (a, b) =>
        a[1].nominal - b[1].nominal || a[1].unit.localeCompare(b[1].unit),
    );
  }, [catalogue.parts]);
  const update = (id: string, patch: Partial<SupplierDefaultRule>) =>
    onChange({
      ...config,
      rules: config.rules.map((rule) =>
        rule.id === id ? { ...rule, ...patch } : rule,
      ),
    });
  const move = (from: number, to: number) => {
    if (from < 0 || to < 0 || to >= config.rules.length || from === to) return;
    const rules = [...config.rules];
    const [rule] = rules.splice(from, 1);
    if (rule) rules.splice(to, 0, rule);
    onChange({ ...config, rules });
  };
  const choose = (
    selected: SupplierVersion | null,
    onSelect: (version: SupplierVersion) => void,
    label: string,
  ) => (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <select
        aria-label={label}
        className="bg-background min-h-11 w-full rounded-md border px-2"
        value={selected ? versionKey(selected) : ""}
        onChange={(event) => {
          const option = options.find(
            (item) => versionKey(item) === event.target.value,
          );
          if (option) onSelect(option);
        }}
      >
        <option value="" disabled>
          Choose supplier
        </option>
        {options.map((option) => (
          <option key={versionKey(option)} value={versionKey(option)}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
  const filter = (
    label: string,
    selected: string | null,
    choices: readonly { id: string; name: string }[],
    onSelect: (id: string | null) => void,
  ) => (
    <label className="block space-y-1 text-xs">
      <span>{label}</span>
      <select
        aria-label={label}
        className="bg-background min-h-10 w-full rounded-md border px-2"
        value={selected ?? ""}
        onChange={(event) => onSelect(event.target.value || null)}
      >
        <option value="">Any {label.toLowerCase()}</option>
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section className="space-y-3" aria-label="Default suppliers">
      <div>
        <h3 className="font-medium">Default suppliers</h3>
        <p className="text-muted-foreground text-sm">
          First matching card wins. Applies to new material items; you can still
          change their supplier.
        </p>
      </div>
      {query.isError && (
        <p role="alert" className="text-destructive text-sm">
          Could not load supplier versions. Reconnect and reopen to choose
          another version.
        </p>
      )}
      {config.rules.map((rule, index) => (
        <div
          key={rule.id}
          className="space-y-3 rounded-lg border p-3"
          draggable
          onDragStart={(event) => {
            event.dataTransfer.setData("text/plain", rule.id);
            setDragged(rule.id);
          }}
          onDragEnd={() => setDragged(null)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const id = dragged ?? event.dataTransfer.getData("text/plain");
            move(
              config.rules.findIndex((item) => item.id === id),
              index,
            );
            setDragged(null);
          }}
        >
          <div className="flex items-center gap-2">
            <GripVerticalIcon aria-hidden className="size-4" />
            <span className="mr-auto text-sm font-medium">
              Rule {index + 1}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Move rule ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, index - 1)}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Move rule ${index + 1} down`}
              disabled={index === config.rules.length - 1}
              onClick={() => move(index, index + 1)}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove rule ${index + 1}`}
              onClick={() =>
                onChange({
                  ...config,
                  rules: config.rules.filter((item) => item.id !== rule.id),
                })
              }
            >
              <TrashIcon />
            </Button>
          </div>
          {choose(
            rule.supplier,
            (supplier) => update(rule.id, { supplier }),
            `Supplier for rule ${index + 1}`,
          )}
          <div className="grid grid-cols-2 gap-2">
            {filter(
              `Catalog for rule ${index + 1}`,
              rule.catalogId,
              catalogue.catalogs.filter((item) => item.kind !== "assets"),
              (catalogId) => update(rule.id, { catalogId }),
            )}
            {filter(
              `Material for rule ${index + 1}`,
              rule.materialId,
              catalogue.materials,
              (materialId) => update(rule.id, { materialId }),
            )}
            {filter(
              `Category for rule ${index + 1}`,
              rule.categoryId,
              catalogue.categories,
              (categoryId) => update(rule.id, { categoryId }),
            )}
            <label className="space-y-1 text-xs">
              <span>Size</span>
              <select
                aria-label={`Size for rule ${index + 1}`}
                className="bg-background min-h-10 w-full rounded-md border px-2"
                value={
                  rule.size
                    ? JSON.stringify({
                        nominal: rule.size.nominal,
                        unit: rule.size.unit,
                        label: rule.size.label ?? null,
                      })
                    : ""
                }
                onChange={(event) =>
                  update(rule.id, {
                    size:
                      sizes.find(([key]) => key === event.target.value)?.[1] ??
                      null,
                  })
                }
              >
                <option value="">Any size</option>
                {sizes.map(([key, size]) => (
                  <option key={key} value={key}>
                    {size.label ?? size.nominal} {size.unit}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={!options.length || config.rules.length >= 50}
        onClick={() => {
          const supplier = config.fallback ?? options[0];
          if (supplier)
            onChange({
              ...config,
              rules: [
                ...config.rules,
                {
                  id: crypto.randomUUID(),
                  catalogId: null,
                  materialId: null,
                  categoryId: null,
                  size: null,
                  supplier,
                },
              ],
            });
        }}
      >
        <PlusIcon />
        Add supplier rule
      </Button>
      <div className="space-y-2 rounded-lg border p-3">
        <h4 className="text-sm font-medium">Fallback · always last</h4>
        <p className="text-muted-foreground text-xs">
          Used when no card matches.
        </p>
        {choose(
          config.fallback,
          (fallback) => onChange({ ...config, fallback }),
          "Fallback supplier",
        )}
        {config.fallback && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={config.rules.length > 0}
            onClick={() => onChange({ ...config, fallback: null })}
          >
            Clear fallback
          </Button>
        )}
      </div>
      {config.rules.length > 0 && !config.fallback && (
        <p role="alert" className="text-destructive text-sm">
          Choose a fallback supplier before saving.
        </p>
      )}
    </section>
  );
}
