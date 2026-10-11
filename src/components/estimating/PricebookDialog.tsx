"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon, PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { api } from "~/trpc/react";
import {
  assemblySchema,
  exportPricingCsv,
  importPricingCsv,
  pricingCsvTemplate,
  pricingRowSchema,
  type EstimateAssembly,
  type EstimateLine,
  type PricingRow,
} from "~/lib/estimating";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { confirmAction } from "~/components/ui/app-dialogs";
import {
  actionClass,
  downloadText,
  errorMessage,
  Field,
  NumberInput,
  MobileFieldLabel,
} from "./estimating-ui";

type Pricebook = {
  revision: number;
  rows: PricingRow[];
  assemblies: EstimateAssembly[];
};
export function PricebookDialog({
  open,
  onOpenChange,
  canEdit,
  assemblyLines = [],
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEdit: boolean;
  assemblyLines?: EstimateLine[];
  onSaved?: () => void;
}) {
  const query = api.estimating.pricing.useQuery(undefined, { enabled: open });
  const save = api.estimating.savePricing.useMutation();
  const [book, setBook] = useState<Pricebook | null>(null);
  const [expandedRates, setExpandedRates] = useState<string[]>([]);
  const rateDetails = (id: string) =>
    expandedRates.includes(id)
      ? "min-w-0 lg:p-1"
      : "hidden lg:table-cell lg:p-1";
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"rates" | "import" | "assemblies">("rates");
  const [csv, setCsv] = useState("");
  const [replace, setReplace] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [assemblyName, setAssemblyName] = useState("");
  const [message, setMessage] = useState("");
  const locked = useRef(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (query.data && !book) setBook(query.data);
  }, [query.data, book]);
  const change = (next: Pricebook) => {
    setBook(next);
    setDirty(true);
    setMessage("");
  };
  const updateRow = (id: string, patch: Partial<PricingRow>) => {
    if (book)
      change({
        ...book,
        rows: book.rows.map((row) =>
          row.id === id ? { ...row, ...patch } : row,
        ),
      });
  };
  const close = async (nextOpen: boolean) => {
    if (save.isPending) return;
    if (
      !nextOpen &&
      dirty &&
      !(await confirmAction({
        title: "Leave pricebook edits?",
        description: "Your pricebook changes have not been saved.",
        confirmLabel: "Discard edits",
        destructive: true,
      }))
    )
      return;
    if (!nextOpen) {
      setBook(null);
      setDirty(false);
      setErrors([]);
      setCsv("");
    }
    onOpenChange(nextOpen);
  };
  const saveBook = async () => {
    if (!book || locked.current) return;
    const invalidRow = book.rows.find(
      (row) => !pricingRowSchema.safeParse(row).success,
    );
    const invalidAssembly = book.assemblies.find(
      (assembly) => !assemblySchema.safeParse(assembly).success,
    );
    if (invalidRow || invalidAssembly) {
      setErrors([
        "Every rate and assembly needs a description, unit, and valid non-negative values.",
      ]);
      return;
    }
    locked.current = true;
    setErrors([]);
    try {
      const result = await save.mutateAsync({
        expectedRevision: book.revision,
        rows: book.rows,
        assemblies: book.assemblies,
      });
      setBook(result);
      setDirty(false);
      setMessage("Organization pricebook saved.");
      await query.refetch();
      onSaved?.();
    } catch (cause) {
      setErrors([
        `${errorMessage(cause)} Your edits are retained. Reload the current pricebook to resolve a version conflict.`,
      ]);
    } finally {
      locked.current = false;
    }
  };
  const reload = async () => {
    if (
      dirty &&
      !(await confirmAction({
        title: "Reload organization pricebook?",
        description: "This discards your unsaved pricebook edits.",
        confirmLabel: "Reload",
        destructive: true,
      }))
    )
      return;
    const result = await query.refetch();
    if (result.data) {
      setBook(result.data);
      setDirty(false);
      setErrors([]);
    }
  };
  const importCsv = () => {
    if (!book || !canEdit) return;
    const result = importPricingCsv(csv);
    setErrors(result.errors);
    if (result.errors.length) return;
    if (!result.rows.length) {
      setErrors(["The CSV has no rate rows."]);
      return;
    }
    const rows = result.rows.map((row) => ({
      ...row,
      id: crypto.randomUUID(),
    }));
    change({ ...book, rows: replace ? rows : [...book.rows, ...rows] });
    setMessage(
      `${rows.length} rates staged. Save the pricebook to apply them.`,
    );
    setTab("rates");
  };
  const addAssembly = () => {
    if (!book || !assemblyName.trim() || !assemblyLines.length) return;
    change({
      ...book,
      assemblies: [
        ...book.assemblies,
        {
          id: crypto.randomUUID(),
          name: assemblyName.trim(),
          unit: "ea",
          description: "",
          lines: assemblyLines.map((line) => ({
            ...line,
            id: crypto.randomUUID(),
            alternateId: null,
            source: {
              kind: "assembly" as const,
              evidence:
                `Template component from ${line.source.kind}${line.source.label ? ` (${line.source.label})` : ""}. ${line.source.evidence ?? ""}`.slice(
                  0,
                  2000,
                ),
            },
            reviewStatus: line.reviewStatus,
          })),
        },
      ],
    });
    setAssemblyName("");
    setMessage(
      "Assembly staged. Save the pricebook to make it available on every estimate.",
    );
  };
  return (
    <Dialog open={open} onOpenChange={(value) => void close(value)}>
      <DialogContent className="max-h-[90svh] min-w-0 overflow-y-auto p-4 sm:max-w-6xl sm:p-6">
        <DialogHeader>
          <DialogTitle>Organization pricebook & assemblies</DialogTitle>
          <DialogDescription>
            Shared rates and repeatable scope. Matching uses the exact
            description, unit, and supplier.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
          <div className="grid w-full min-w-0 grid-cols-3 gap-1 sm:flex sm:w-auto">
            {(["rates", "import", "assemblies"] as const).map((value) => (
              <Button
                key={value}
                className="h-auto min-h-11 min-w-0 px-1 whitespace-normal sm:min-h-9 sm:px-3"
                size="sm"
                variant={tab === value ? "secondary" : "ghost"}
                onClick={() => setTab(value)}
              >
                {value === "rates"
                  ? `Rates (${book?.rows.length ?? 0})`
                  : value === "import"
                    ? "CSV import"
                    : `Assemblies (${book?.assemblies.length ?? 0})`}
              </Button>
            ))}
          </div>
          <span className="text-muted-foreground text-xs">
            Revision {book?.revision ?? "…"}
            {dirty ? " · Unsaved changes" : ""}
          </span>
        </div>
        {query.isLoading && !book && (
          <p
            role="status"
            className="text-muted-foreground py-10 text-center text-sm"
          >
            Loading pricebook…
          </p>
        )}
        {query.error && (
          <p role="alert" className="text-destructive text-sm">
            {query.error.message}
          </p>
        )}
        {book && tab === "rates" && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted-foreground text-xs">
                Enter unit rates before adjustments. An unspecified currency
                adopts the estimate currency; no currency conversion is applied.
              </p>
              {canEdit && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() =>
                    change({
                      ...book,
                      rows: [
                        ...book.rows,
                        pricingRowSchema.parse({
                          id: crypto.randomUUID(),
                          description: "New rate",
                          priceSource: "manual",
                          updatedAt: new Date().toISOString(),
                        }),
                      ],
                    })
                  }
                >
                  <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
                  Add rate
                </Button>
              )}
            </div>
            <div className="rounded border lg:max-h-[45svh] lg:overflow-auto">
              <table className="block w-full text-left text-sm lg:table lg:min-w-[1800px] lg:text-xs">
                <thead className="bg-muted sticky top-0 z-10 hidden lg:table-header-group">
                  <tr>
                    {[
                      "Description",
                      "SKU",
                      "Unit",
                      "Currency",
                      "Material / unit",
                      "Labor hr / unit",
                      "Equipment / unit",
                      "Subcontract / unit",
                      "Other / unit",
                      "Order multiple",
                      "Supplier",
                      "Trade",
                      "Cost code",
                      "Price date",
                      "Evidence source",
                      "",
                    ].map((label) => (
                      <th key={label} className="px-2 py-3 font-medium">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="block divide-y lg:table-row-group">
                  {book.rows.map((row) => (
                    <tr
                      key={row.id}
                      className="hover:bg-muted/30 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 p-3 lg:table-row lg:p-0"
                    >
                      <td className="col-span-2 min-w-0 lg:p-1">
                        <MobileFieldLabel>Description</MobileFieldLabel>
                        <Textarea
                          aria-label={`description for ${row.description}`}
                          value={row.description}
                          rows={2}
                          disabled={!canEdit || save.isPending}
                          className="[field-sizing:content] min-h-11 min-w-0 resize-none text-base lg:[field-sizing:fixed] lg:h-8 lg:min-h-8 lg:min-w-52 lg:text-xs"
                          onChange={(event) =>
                            updateRow(row.id, {
                              description: event.target.value,
                            })
                          }
                        />
                      </td>
                      {(["sku", "unit"] as const).map((key) => (
                        <td
                          key={key}
                          className={
                            key === "sku"
                              ? rateDetails(row.id)
                              : "min-w-0 lg:p-1"
                          }
                        >
                          <MobileFieldLabel>
                            {key === "sku" ? "SKU" : "Unit"}
                          </MobileFieldLabel>
                          <Input
                            aria-label={`${key} for ${row.description}`}
                            value={row[key]}
                            disabled={!canEdit || save.isPending}
                            className="h-11 min-w-0 text-base lg:h-8 lg:min-w-20 lg:text-xs"
                            onChange={(event) =>
                              updateRow(row.id, { [key]: event.target.value })
                            }
                          />
                        </td>
                      ))}
                      <td className="min-w-0 lg:p-1">
                        <MobileFieldLabel>Currency</MobileFieldLabel>
                        <select
                          aria-label={`Currency for ${row.description}`}
                          value={row.currency ?? ""}
                          disabled={!canEdit || save.isPending}
                          className="bg-background h-11 w-full min-w-0 rounded border px-2 text-base lg:h-8 lg:w-auto lg:text-xs"
                          onChange={(event) =>
                            updateRow(row.id, {
                              currency: event.target.value
                                ? (event.target.value as NonNullable<
                                    PricingRow["currency"]
                                  >)
                                : undefined,
                            })
                          }
                        >
                          <option value="">Default</option>
                          {["CAD", "USD", "GBP", "EUR"].map((currency) => (
                            <option key={currency}>{currency}</option>
                          ))}
                        </select>
                      </td>
                      {(
                        [
                          "materialUnitCost",
                          "laborHoursPerUnit",
                          "equipmentUnitCost",
                          "subcontractUnitCost",
                          "otherUnitCost",
                          "orderMultiple",
                        ] as const
                      ).map((key) => (
                        <td
                          key={key}
                          className={
                            key === "materialUnitCost" ||
                            key === "laborHoursPerUnit"
                              ? "min-w-0 lg:p-1"
                              : rateDetails(row.id)
                          }
                        >
                          <MobileFieldLabel>
                            {
                              {
                                materialUnitCost: "Material / unit",
                                laborHoursPerUnit: "Labor hr / unit",
                                equipmentUnitCost: "Equipment / unit",
                                subcontractUnitCost: "Subcontract / unit",
                                otherUnitCost: "Other / unit",
                                orderMultiple: "Order multiple",
                              }[key]
                            }
                          </MobileFieldLabel>
                          <NumberInput
                            aria-label={`${key} for ${row.description}`}
                            value={row[key]}
                            nullable={
                              key === "materialUnitCost" ||
                              key === "orderMultiple"
                            }
                            disabled={!canEdit || save.isPending}
                            onChange={(value) =>
                              updateRow(row.id, { [key]: value })
                            }
                          />
                        </td>
                      ))}
                      {(["supplierName", "trade", "costCode"] as const).map(
                        (key) => (
                          <td key={key} className={rateDetails(row.id)}>
                            <MobileFieldLabel>
                              {
                                {
                                  supplierName: "Supplier",
                                  trade: "Trade",
                                  costCode: "Cost code",
                                }[key]
                              }
                            </MobileFieldLabel>
                            <Input
                              aria-label={`${key} for ${row.description}`}
                              value={row[key]}
                              className="h-11 min-w-0 text-base lg:h-8 lg:min-w-32 lg:text-xs"
                              disabled={!canEdit || save.isPending}
                              onChange={(event) =>
                                updateRow(row.id, { [key]: event.target.value })
                              }
                            />
                          </td>
                        ),
                      )}
                      <td className={`${rateDetails(row.id)} col-span-2`}>
                        <MobileFieldLabel>Price date</MobileFieldLabel>
                        <Input
                          aria-label={`Price date for ${row.description}`}
                          type="date"
                          value={row.updatedAt?.slice(0, 10) ?? ""}
                          className="h-11 w-full min-w-0 text-base lg:h-8 lg:min-w-36 lg:text-xs"
                          disabled={!canEdit || save.isPending}
                          onChange={(event) =>
                            updateRow(row.id, {
                              updatedAt: event.target.value || undefined,
                            })
                          }
                        />
                      </td>
                      <td className={`${rateDetails(row.id)} col-span-2`}>
                        <MobileFieldLabel>Evidence source</MobileFieldLabel>
                        <select
                          aria-label={`Pricing evidence for ${row.description}`}
                          value={row.priceSource ?? ""}
                          disabled={!canEdit || save.isPending}
                          className="bg-background h-11 w-full min-w-0 rounded border px-2 text-base lg:h-8 lg:w-auto lg:text-xs"
                          onChange={(event) =>
                            updateRow(row.id, {
                              priceSource: event.target.value
                                ? (event.target.value as NonNullable<
                                    PricingRow["priceSource"]
                                  >)
                                : undefined,
                            })
                          }
                        >
                          <option value="">Imported / unspecified</option>
                          {[
                            "manual",
                            "supplier",
                            "imported",
                            "simulated",
                            "missing",
                          ].map((source) => (
                            <option key={source}>{source}</option>
                          ))}
                        </select>
                      </td>
                      <td className="col-span-2 border-t pt-2 lg:border-0 lg:p-0">
                        <div className="flex items-center justify-between gap-2">
                          <Button
                            className="h-11 lg:hidden"
                            variant="ghost"
                            size="sm"
                            aria-expanded={expandedRates.includes(row.id)}
                            onClick={() =>
                              setExpandedRates(
                                expandedRates.includes(row.id)
                                  ? expandedRates.filter((id) => id !== row.id)
                                  : [...expandedRates, row.id],
                              )
                            }
                          >
                            {expandedRates.includes(row.id)
                              ? "Less detail"
                              : "More detail"}
                          </Button>
                          {canEdit && (
                            <Button
                              aria-label={`Delete rate ${row.description}`}
                              className="h-11 w-11 lg:h-9 lg:w-9"
                              size="icon"
                              variant="ghost"
                              disabled={save.isPending}
                              onClick={() =>
                                change({
                                  ...book,
                                  rows: book.rows.filter(
                                    (item) => item.id !== row.id,
                                  ),
                                })
                              }
                            >
                              <Trash2Icon className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!book.rows.length && (
                <p className="text-muted-foreground p-10 text-center text-sm">
                  No rates yet. Add a rate or import a CSV pricebook.
                </p>
              )}
            </div>
          </>
        )}
        {book && tab === "import" && (
          <div className="grid gap-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadText(
                    "estimating-pricebook-template.csv",
                    pricingCsvTemplate(),
                  )
                }
              >
                <DownloadIcon className="mr-2 h-4 w-4" />
                Download CSV template
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadText(
                    "organization-pricebook.csv",
                    exportPricingCsv(book.rows),
                  )
                }
              >
                <DownloadIcon className="mr-2 h-4 w-4" />
                Download current rates
              </Button>
              {canEdit && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => file.current?.click()}
                  >
                    <UploadIcon className="mr-2 h-4 w-4" />
                    Upload CSV
                  </Button>
                  <input
                    ref={file}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(event) => {
                      const selected = event.target.files?.[0];
                      if (selected) {
                        if (selected.size > 5_000_000) {
                          setErrors(["CSV exceeds the 5 MB limit."]);
                          return;
                        }
                        void selected
                          .text()
                          .then(setCsv)
                          .catch((cause: unknown) =>
                            setErrors([errorMessage(cause)]),
                          );
                      }
                      event.target.value = "";
                    }}
                  />
                </>
              )}
            </div>
            <Field
              label="Paste CSV"
              hint="Required columns: description, unit, materialUnitCost. Use decimal numbers without currency symbols or thousands separators."
            >
              <Textarea
                value={csv}
                disabled={!canEdit}
                onChange={(event) => setCsv(event.target.value)}
                rows={9}
                className="font-mono text-xs"
                placeholder="Paste the header and rate rows from your CSV file"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replace}
                onChange={(event) => setReplace(event.target.checked)}
                disabled={!canEdit}
              />
              Replace all existing rates on import
            </label>
            <Button
              className={`${actionClass} justify-self-start`}
              disabled={!canEdit || !csv.trim() || save.isPending}
              onClick={importCsv}
            >
              Validate & stage import
            </Button>
          </div>
        )}
        {book && tab === "assemblies" && (
          <div className="space-y-4">
            {canEdit && (
              <div className="flex flex-wrap items-end gap-3 border-b pb-4">
                <Field
                  label={`Save selected estimate rows as an assembly (${assemblyLines.length} rows)`}
                >
                  <Input
                    value={assemblyName}
                    onChange={(event) => setAssemblyName(event.target.value)}
                    placeholder="Assembly name"
                    disabled={!assemblyLines.length}
                  />
                </Field>
                <Button
                  variant="outline"
                  disabled={
                    !assemblyLines.length ||
                    !assemblyName.trim() ||
                    save.isPending
                  }
                  onClick={addAssembly}
                >
                  Create assembly
                </Button>
                <p className="text-muted-foreground w-full text-xs">
                  Select cost rows in an estimate to define components per one
                  assembly unit.
                </p>
              </div>
            )}
            {book.assemblies.map((assembly) => (
              <div key={assembly.id} className="space-y-2 border-b pb-4">
                <div className="flex gap-2">
                  <Input
                    aria-label="Assembly name"
                    value={assembly.name}
                    disabled={!canEdit || save.isPending}
                    onChange={(event) =>
                      change({
                        ...book,
                        assemblies: book.assemblies.map((item) =>
                          item.id === assembly.id
                            ? { ...item, name: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label="Assembly unit"
                    value={assembly.unit}
                    className="w-24"
                    disabled={!canEdit || save.isPending}
                    onChange={(event) =>
                      change({
                        ...book,
                        assemblies: book.assemblies.map((item) =>
                          item.id === assembly.id
                            ? { ...item, unit: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                  {canEdit && (
                    <Button
                      aria-label={`Delete assembly ${assembly.name}`}
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        change({
                          ...book,
                          assemblies: book.assemblies.filter(
                            (item) => item.id !== assembly.id,
                          ),
                        })
                      }
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  {assembly.lines.length} components per {assembly.unit}
                </p>
                <div className="divide-y">
                  {assembly.lines.map((line) => (
                    <div
                      key={line.id}
                      className="flex items-center gap-3 py-1 text-xs"
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {line.description}
                      </span>
                      <NumberInput
                        className="max-w-24"
                        aria-label={`Quantity of ${line.description} in ${assembly.name}`}
                        value={line.quantity}
                        disabled={!canEdit || save.isPending}
                        onChange={(value) =>
                          change({
                            ...book,
                            assemblies: book.assemblies.map((item) =>
                              item.id === assembly.id
                                ? {
                                    ...item,
                                    lines: item.lines.map((component) =>
                                      component.id === line.id
                                        ? { ...component, quantity: value ?? 0 }
                                        : component,
                                    ),
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                      <span className="text-muted-foreground w-12">
                        {line.unit}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {!book.assemblies.length && (
              <p className="text-muted-foreground py-8 text-sm">
                No assemblies yet. Select rows from an estimate and save them
                here for reuse.
              </p>
            )}
          </div>
        )}
        {errors.length > 0 && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive/5 text-destructive max-h-32 overflow-y-auto rounded border p-3 text-xs"
          >
            {errors.slice(0, 30).map((error, index) => (
              <p key={index}>{error}</p>
            ))}
            {errors.length > 30 && (
              <p>
                {errors.length - 30} more errors. Correct the file before
                importing.
              </p>
            )}
          </div>
        )}
        {message && (
          <p role="status" className="text-sm text-blue-700 dark:text-blue-400">
            {message}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => void reload()}
          >
            Reload current
          </Button>
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => void close(false)}
          >
            Close
          </Button>
          {canEdit && (
            <Button
              className={actionClass}
              disabled={!dirty || save.isPending}
              onClick={() => void saveBook()}
            >
              {save.isPending ? "Saving…" : "Save pricebook"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
