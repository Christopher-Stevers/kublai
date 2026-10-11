"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  InfoIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import type {
  CalculatedEstimateLine,
  EstimateDocument,
  EstimateLine,
} from "~/lib/estimating";
import { newEstimateLine } from "~/lib/estimating";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  actionClass,
  Field,
  money,
  MobileFieldLabel,
  NumberInput,
  quantity,
  selectClass,
} from "./estimating-ui";

export type EstimateSheet = {
  id: string;
  number: string;
  title: string;
  pageNumber: number;
  setId?: string;
  revision?: string;
};
export function isDrawingSourceStale(
  line: EstimateLine,
  sheet?: EstimateSheet,
) {
  return (
    (line.source.kind === "drawing-measurement" ||
      line.source.kind === "drawing-schedule") &&
    Boolean(
      line.source.fingerprint &&
      line.source.revision &&
      sheet?.revision &&
      sheet.revision !== line.source.revision,
    )
  );
}
export function EstimateLines({
  document,
  lines,
  jobId,
  sheets,
  disabled,
  canDrawings,
  selected,
  onSelected,
  onChange,
  onApprove,
  onAssembly,
  onAssignMaterial,
  calculationValid = true,
}: {
  document: EstimateDocument;
  lines: CalculatedEstimateLine[];
  jobId: string;
  sheets: EstimateSheet[];
  disabled: boolean;
  canDrawings: boolean;
  selected: string[];
  onSelected: (ids: string[]) => void;
  onChange: (document: EstimateDocument) => void;
  onApprove: (ids?: string[]) => void;
  onAssembly: () => void;
  onAssignMaterial: (id: string) => void;
  calculationValid?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [expandedRows, setExpandedRows] = useState<string[]>([]);
  const [rowPage, setRowPage] = useState(() =>
    Math.max(
      0,
      Math.floor(lines.findIndex((line) => line.id === selected[0]) / 50),
    ),
  );
  const filtered = lines.filter(
    (line) =>
      (!search ||
        `${line.description} ${line.trade} ${line.area} ${line.costCode}`
          .toLowerCase()
          .includes(search.toLowerCase())) &&
      (!reviewFilter ||
        (reviewFilter === "warnings"
          ? line.warnings.length > 0
          : line.reviewStatus === reviewFilter)),
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / 50));
  const page = Math.min(rowPage, pageCount - 1);
  const visible = filtered.slice(page * 50, (page + 1) * 50);
  const inspect = lines.find((line) => line.id === inspectId);
  const currency = document.settings.currency;
  const update = (id: string, patch: Partial<EstimateLine>) => {
    onChange({
      ...document,
      lines: document.lines.map((line) =>
        line.id === id
          ? {
              ...line,
              ...patch,
              ...((patch.quantity !== undefined ||
                patch.multiplier !== undefined ||
                patch.unit !== undefined) &&
              line.source.kind !== "manual" &&
              line.source.kind !== "catalogue"
                ? { reviewStatus: "unreviewed" as const }
                : {}),
            }
          : line,
      ),
    });
  };
  const remove = (ids: string[]) => {
    onChange({
      ...document,
      lines: document.lines.filter((line) => !ids.includes(line.id)),
    });
    onSelected(selected.filter((id) => !ids.includes(id)));
  };
  const inspectorSheet = sheets.find(
    (sheet) => sheet.id === inspect?.source.sheetId,
  );
  const detailCell = (id: string, classes = "") =>
    cn(
      advanced || expandedRows.includes(id) ? "block" : "hidden",
      "lg:table-cell",
      classes,
    );
  const allSelected =
    visible.length > 0 && visible.every((line) => selected.includes(line.id));
  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Takeoff & costs</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {lines.length} rows · Demand is quantity × multiplier; purchasing
            adds waste and order multiples.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? "Fewer columns" : "All cost fields"}
          </Button>
          <Button
            className={actionClass}
            size="sm"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...document,
                lines: [
                  ...document.lines,
                  newEstimateLine({
                    description: "New item",
                    quantity: 1,
                    reviewStatus: "approved",
                  }),
                ],
              })
            }
          >
            <PlusIcon className="mr-1.5 h-3.5 w-3.5" />
            Add row
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="relative min-w-40 flex-1">
          <SearchIcon className="text-muted-foreground absolute top-2 left-2.5 h-3.5 w-3.5" />
          <Input
            aria-label="Filter cost rows"
            className="h-8 pl-8 text-xs"
            placeholder="Find description, trade, area, cost code…"
            value={search}
            onChange={(event) => {
              setRowPage(0);
              setSearch(event.target.value);
            }}
          />
        </div>
        <select
          aria-label="Filter review status"
          className={cn(selectClass, "h-8 text-xs")}
          value={reviewFilter}
          onChange={(event) => {
            setRowPage(0);
            setReviewFilter(event.target.value);
          }}
        >
          <option value="">All rows</option>
          <option value="warnings">Needs attention</option>
          <option value="unreviewed">Unreviewed</option>
          <option value="approved">Reviewed</option>
          <option value="excluded">Excluded</option>
        </select>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-y bg-blue-500/5 px-4 py-2 text-xs">
          <span className="mr-auto font-medium">
            {selected.length} selected
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onApprove()}
          >
            <CheckCheckIcon className="mr-1.5 h-3.5 w-3.5" />
            Approve evidence
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onAssembly}
          >
            Save assembly
          </Button>
          {selected.length === 1 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onAssignMaterial(selected[0]!)}
            >
              Assign catalogue material
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...document,
                lines: document.lines.map((line) =>
                  selected.includes(line.id)
                    ? { ...line, reviewStatus: "excluded" }
                    : line,
                ),
              })
            }
          >
            Exclude
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => remove(selected)}
          >
            <Trash2Icon className="mr-1.5 h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      )}
      <div className="lg:max-h-[68svh] lg:overflow-auto">
        <table
          className={`block w-full text-left text-sm lg:table lg:text-xs ${advanced ? "lg:min-w-[2350px]" : "lg:min-w-[1300px]"}`}
        >
          <thead className="bg-muted text-muted-foreground sticky top-0 z-10 hidden text-[11px] lg:table-header-group">
            <tr>
              <th className="w-10 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label="Select visible cost rows"
                  checked={allSelected}
                  onChange={() =>
                    onSelected(
                      allSelected
                        ? selected.filter(
                            (id) => !visible.some((line) => line.id === id),
                          )
                        : [
                            ...new Set([
                              ...selected,
                              ...visible.map((line) => line.id),
                            ]),
                          ],
                    )
                  }
                />
              </th>
              <th className="w-64 px-2 py-3 font-medium">
                Description / evidence
              </th>
              <th className="w-20 px-2 py-3 text-right font-medium">
                Quantity
              </th>
              <th className="w-16 px-2 py-3 font-medium">Unit</th>
              <th className="w-20 px-2 py-3 text-right font-medium">
                × Factor
              </th>
              <th className="w-20 px-2 py-3 text-right font-medium">Waste %</th>
              <th className="w-20 px-2 py-3 text-right font-medium">Demand</th>
              <th
                className="w-24 px-2 py-3 text-right font-medium"
                title="This row's share of pack-rounded purchasing for the same material. Shared packs are allocated across rows for costing; fractional shares are not individual order quantities."
              >
                Purchase share
              </th>
              <th className="w-24 px-2 py-3 text-right font-medium">
                Material / unit
              </th>
              <th className="w-24 px-2 py-3 text-right font-medium">
                Labor hr / unit
              </th>
              <th className="w-20 px-2 py-3 text-right font-medium">
                Labor hr
              </th>
              {advanced && (
                <>
                  {[
                    "Equipment / unit",
                    "Subcontract / unit",
                    "Other / unit",
                    "Order multiple",
                    "Labor rate",
                    "Trade",
                    "Area",
                    "Phase",
                    "Cost code",
                    "Supplier",
                  ].map((label) => (
                    <th key={label} className="w-28 px-2 py-3 font-medium">
                      {label}
                    </th>
                  ))}
                </>
              )}
              <th className="w-28 px-2 py-3 text-right font-medium">
                Direct cost
              </th>
              <th className="w-28 px-2 py-3 font-medium">Review / option</th>
              <th className="w-16 px-2 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="block divide-y lg:table-row-group">
            {visible.map((line) => (
              <tr
                key={line.id}
                className={`group relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-3 p-4 transition-colors lg:table-row lg:p-0 ${selected.includes(line.id) ? "bg-blue-500/5" : "hover:bg-muted/30"} ${line.reviewStatus === "excluded" ? "opacity-50" : ""}`}
              >
                <td className="absolute top-2 right-2 p-3 lg:static lg:px-3">
                  <input
                    type="checkbox"
                    aria-label={`Select ${line.description}`}
                    checked={selected.includes(line.id)}
                    onChange={() =>
                      onSelected(
                        selected.includes(line.id)
                          ? selected.filter((id) => id !== line.id)
                          : [...selected, line.id],
                      )
                    }
                  />
                </td>
                <td className="col-span-2 min-w-0 pr-10 lg:p-1.5">
                  <Textarea
                    aria-label="Line description"
                    value={line.description}
                    rows={2}
                    className="hover:border-border focus:bg-background [field-sizing:content] min-h-11 w-full min-w-0 resize-none border-transparent bg-transparent px-0 py-1 text-base leading-snug shadow-none lg:[field-sizing:fixed] lg:h-8 lg:min-h-8 lg:min-w-52 lg:px-1 lg:text-xs"
                    disabled={disabled}
                    onChange={(event) =>
                      update(line.id, { description: event.target.value })
                    }
                  />
                  <button
                    onClick={() => setInspectId(line.id)}
                    className="text-muted-foreground flex min-h-9 w-full min-w-0 items-center gap-1 text-left text-xs break-words hover:text-blue-600 lg:max-w-64 lg:px-1 lg:text-[10px]"
                  >
                    <InfoIcon className="h-3 w-3 shrink-0" />
                    {line.warnings.length
                      ? `${line.warnings.length} review item${line.warnings.length === 1 ? "" : "s"} · `
                      : ""}
                    {line.source.label ?? line.source.kind.replaceAll("-", " ")}
                  </button>
                </td>
                {(
                  ["quantity", "unit", "multiplier", "wastePercent"] as const
                ).map((key) => (
                  <td
                    key={key}
                    className={
                      key === "quantity" || key === "unit"
                        ? "min-w-0 lg:p-1"
                        : detailCell(line.id, "min-w-0 lg:p-1")
                    }
                  >
                    <MobileFieldLabel>
                      {
                        {
                          quantity: "Quantity",
                          unit: "Unit",
                          multiplier: "Multiplier",
                          wastePercent: "Waste %",
                        }[key]
                      }
                    </MobileFieldLabel>
                    {key === "unit" ? (
                      <Input
                        aria-label={`Unit for ${line.description}`}
                        value={line.unit}
                        className="hover:border-border h-11 w-full min-w-0 bg-transparent px-2 text-base lg:h-8 lg:w-16 lg:border-transparent lg:text-xs"
                        disabled={disabled}
                        onChange={(event) =>
                          update(line.id, { unit: event.target.value })
                        }
                      />
                    ) : (
                      <NumberInput
                        aria-label={`${key === "quantity" ? "Quantity" : key} for ${line.description}`}
                        value={line[key]}
                        disabled={disabled}
                        onChange={(value) =>
                          update(line.id, { [key]: value ?? 0 })
                        }
                      />
                    )}
                  </td>
                ))}
                <td
                  className={detailCell(
                    line.id,
                    "text-muted-foreground min-w-0 break-words tabular-nums lg:px-2 lg:text-right",
                  )}
                >
                  <MobileFieldLabel>Demand</MobileFieldLabel>
                  {calculationValid ? quantity(line.demand) : "—"}
                </td>
                <td
                  className={detailCell(
                    line.id,
                    "min-w-0 break-words tabular-nums lg:px-2 lg:text-right",
                  )}
                >
                  <MobileFieldLabel>Purchase share</MobileFieldLabel>
                  {calculationValid ? quantity(line.purchaseQuantity) : "—"}
                </td>
                <td className="min-w-0 lg:p-1">
                  <MobileFieldLabel>
                    Material / unit · {currency}
                  </MobileFieldLabel>
                  <NumberInput
                    aria-label={`Material unit price for ${line.description}`}
                    value={line.materialUnitCost}
                    nullable
                    disabled={disabled}
                    placeholder="Missing"
                    className={
                      line.materialUnitCost === null
                        ? "text-amber-700 dark:text-amber-400"
                        : ""
                    }
                    onChange={(value) =>
                      update(line.id, {
                        materialUnitCost: value,
                        priceSource: value === null ? "missing" : "manual",
                        priceCurrency: document.settings.currency,
                        priceRowId: undefined,
                        priceUpdatedAt: new Date().toISOString(),
                      })
                    }
                  />
                </td>
                <td className={detailCell(line.id, "min-w-0 lg:p-1")}>
                  <MobileFieldLabel>Labor hours / unit</MobileFieldLabel>
                  <NumberInput
                    aria-label={`Labor hours per unit for ${line.description}`}
                    value={line.laborHoursPerUnit}
                    disabled={disabled}
                    onChange={(value) =>
                      update(line.id, { laborHoursPerUnit: value ?? 0 })
                    }
                  />
                </td>
                <td
                  className={detailCell(
                    line.id,
                    "text-muted-foreground min-w-0 break-words tabular-nums lg:px-2 lg:text-right",
                  )}
                >
                  <MobileFieldLabel>Labor hours</MobileFieldLabel>
                  {calculationValid ? quantity(line.laborHours) : "—"}
                </td>
                {(advanced || expandedRows.includes(line.id)) && (
                  <>
                    {(
                      [
                        "equipmentUnitCost",
                        "subcontractUnitCost",
                        "otherUnitCost",
                        "orderMultiple",
                        "laborRate",
                      ] as const
                    ).map((key) => (
                      <td
                        key={key}
                        className={cn(
                          "min-w-0 lg:p-1",
                          !advanced && "lg:hidden",
                        )}
                      >
                        <MobileFieldLabel>
                          {
                            {
                              equipmentUnitCost: "Equipment / unit",
                              subcontractUnitCost: "Subcontract / unit",
                              otherUnitCost: "Other / unit",
                              orderMultiple: "Order multiple",
                              laborRate: "Labor rate",
                            }[key]
                          }
                        </MobileFieldLabel>
                        <NumberInput
                          aria-label={`${key} for ${line.description}`}
                          value={line[key]}
                          nullable={
                            key === "orderMultiple" || key === "laborRate"
                          }
                          disabled={disabled}
                          placeholder={key === "laborRate" ? "Default" : ""}
                          onChange={(value) =>
                            update(line.id, { [key]: value })
                          }
                        />
                      </td>
                    ))}
                    {(
                      [
                        "trade",
                        "area",
                        "phase",
                        "costCode",
                        "supplierName",
                      ] as const
                    ).map((key) => (
                      <td
                        key={key}
                        className={cn(
                          "min-w-0 lg:p-1",
                          !advanced && "lg:hidden",
                        )}
                      >
                        <MobileFieldLabel>
                          {
                            {
                              trade: "Trade",
                              area: "Area",
                              phase: "Phase",
                              costCode: "Cost code",
                              supplierName: "Supplier",
                            }[key]
                          }
                        </MobileFieldLabel>
                        <Input
                          aria-label={`${key} for ${line.description}`}
                          value={line[key]}
                          disabled={disabled}
                          className="hover:border-border h-11 w-full min-w-0 bg-transparent px-2 text-base lg:h-8 lg:min-w-24 lg:border-transparent lg:text-xs"
                          onChange={(event) =>
                            update(line.id, { [key]: event.target.value })
                          }
                        />
                      </td>
                    ))}
                  </>
                )}
                <td className="flex min-w-0 flex-col justify-center font-semibold break-words tabular-nums lg:table-cell lg:px-2 lg:text-right">
                  <MobileFieldLabel>Direct cost · {currency}</MobileFieldLabel>
                  {calculationValid ? money(line.directCost, currency) : "—"}
                </td>
                <td
                  className={detailCell(
                    line.id,
                    "col-span-2 min-w-0 space-y-2 lg:space-y-1 lg:p-1.5",
                  )}
                >
                  <label className="min-w-0">
                    <MobileFieldLabel>Review</MobileFieldLabel>
                    <select
                      aria-label={`Review ${line.description}`}
                      value={line.reviewStatus}
                      className={cn(
                        selectClass,
                        "h-11 w-full min-w-0 bg-transparent text-base lg:h-7 lg:border-transparent lg:text-[10px]",
                      )}
                      disabled={disabled}
                      onChange={(event) => {
                        const reviewStatus = event.target
                          .value as EstimateLine["reviewStatus"];
                        if (
                          reviewStatus === "approved" &&
                          line.reviewStatus !== "approved" &&
                          [
                            "ai",
                            "room",
                            "drawing-measurement",
                            "drawing-schedule",
                          ].includes(line.source.kind)
                        ) {
                          onSelected([line.id]);
                          setInspectId(line.id);
                        } else update(line.id, { reviewStatus });
                      }}
                    >
                      <option value="unreviewed">Unreviewed</option>
                      <option value="approved">Reviewed</option>
                      <option value="excluded">Excluded</option>
                    </select>
                  </label>
                  <label className="min-w-0">
                    <MobileFieldLabel>Bid option</MobileFieldLabel>
                    <select
                      aria-label={`Alternate for ${line.description}`}
                      value={line.alternateId ?? ""}
                      className={cn(
                        selectClass,
                        "h-11 w-full min-w-0 bg-transparent text-base lg:h-7 lg:border-transparent lg:text-[10px]",
                      )}
                      disabled={disabled}
                      onChange={(event) =>
                        update(line.id, {
                          alternateId: event.target.value || null,
                        })
                      }
                    >
                      <option value="">Base bid</option>
                      {document.alternates.map((alternate) => (
                        <option key={alternate.id} value={alternate.id}>
                          {alternate.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </td>
                <td className="col-span-2 border-t pt-2 lg:border-0 lg:p-1">
                  <div className="flex flex-wrap items-center gap-1 lg:gap-0">
                    <Button
                      className="mr-auto h-11 px-2 lg:hidden"
                      size="sm"
                      variant="ghost"
                      aria-expanded={advanced || expandedRows.includes(line.id)}
                      onClick={() =>
                        setExpandedRows(
                          expandedRows.includes(line.id)
                            ? expandedRows.filter((id) => id !== line.id)
                            : [...expandedRows, line.id],
                        )
                      }
                      disabled={advanced}
                    >
                      {advanced || expandedRows.includes(line.id)
                        ? "Less detail"
                        : "More detail"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Duplicate ${line.description}`}
                      className="h-11 w-11 lg:h-7 lg:w-7"
                      disabled={disabled}
                      onClick={() =>
                        onChange({
                          ...document,
                          lines: [
                            ...document.lines,
                            {
                              ...line,
                              id: crypto.randomUUID(),
                              source: {
                                kind: "manual",
                                label: `Copy of ${line.description}`,
                              },
                              reviewStatus: "unreviewed",
                            },
                          ],
                        })
                      }
                    >
                      <CopyIcon className="h-3 w-3" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${line.description}`}
                      className="h-11 w-11 lg:h-7 lg:w-7"
                      disabled={disabled}
                      onClick={() => remove([line.id])}
                    >
                      <Trash2Icon className="h-3 w-3" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visible.length && (
          <div className="px-6 py-14 text-center">
            <h3 className="text-sm font-semibold">
              {lines.length ? "No matching rows" : "Add your takeoff"}
            </h3>
            <p className="text-muted-foreground mt-2 text-sm">
              {lines.length
                ? "Change the row filters to see your costs."
                : "Add manual rows, search the catalogue, import job lists, or analyze drawing evidence."}
            </p>
          </div>
        )}
      </div>
      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-xs">
        <span>
          {filtered.length
            ? `${page * 50 + 1}–${Math.min((page + 1) * 50, filtered.length)} of ${filtered.length} matching rows`
            : "0 matching rows"}{" "}
          · Totals include the entire estimate
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setRowPage(page - 1)}
          >
            Previous rows
          </Button>
          <span>
            Page {page + 1} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= pageCount}
            onClick={() => setRowPage(page + 1)}
          >
            Next rows
          </Button>
        </div>
      </div>
      <Dialog
        open={Boolean(inspect)}
        onOpenChange={(open) => {
          if (!open) setInspectId(null);
        }}
      >
        <DialogContent className="max-h-[88svh] overflow-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{inspect?.description}</DialogTitle>
            <DialogDescription>
              Verify the source quantity and scope before marking this evidence
              reviewed.
            </DialogDescription>
          </DialogHeader>
          {inspect && (
            <>
              <div className="grid min-w-0 grid-cols-2 gap-4 border-y py-4 text-sm [&>div]:min-w-0 [&>div]:break-words">
                <div>
                  <p className="text-muted-foreground text-xs">Source</p>
                  <p className="mt-1">
                    {inspect.source.kind.replaceAll("-", " ")}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Confidence</p>
                  <p className="mt-1">
                    {inspect.source.confidence === undefined
                      ? "Not recorded"
                      : `${Math.round(inspect.source.confidence * 100)}%`}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">
                    Demand / purchase share
                  </p>
                  <p className="mt-1">
                    {calculationValid
                      ? `${quantity(inspect.demand)} / ${quantity(inspect.purchaseQuantity)} ${inspect.unit}`
                      : "Unavailable until cost values are corrected"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Pricing</p>
                  <p className="mt-1">
                    {inspect.priceSource} · {inspect.priceCurrency ?? currency}{" "}
                    · {inspect.priceUpdatedAt?.slice(0, 10) ?? "Undated"}
                  </p>
                </div>
              </div>
              <p className="text-muted-foreground text-xs">
                Purchase share allocates the pack-rounded total for a shared
                material across its rows. Fractional shares are cost
                allocations, not individual order quantities.
              </p>
              {inspect.source.evidence && (
                <p className="bg-muted/40 rounded p-3 text-sm break-words whitespace-pre-wrap">
                  {inspect.source.evidence}
                </p>
              )}
              {inspect.source.revision && (
                <p className="text-muted-foreground text-xs">
                  Source drawing revision: {inspect.source.revision}
                </p>
              )}
              {isDrawingSourceStale(inspect, inspectorSheet) && (
                <p
                  role="alert"
                  className="text-sm text-amber-700 dark:text-amber-400"
                >
                  The saved measurement or source drawing has changed. Remove
                  this row and analyze its sheet again to import current
                  evidence.
                </p>
              )}
              {canDrawings &&
                (inspect.source.sheetId ?? inspect.source.floorId) && (
                  <Button asChild variant="outline">
                    <Link
                      href={
                        inspect.source.sheetId
                          ? `/dashboard/jobs/${jobId}/drawings?drawingSheet=${inspect.source.sheetId}${inspectorSheet?.setId ? `&drawingSet=${inspectorSheet.setId}` : ""}`
                          : `/dashboard/jobs/${jobId}/rooms`
                      }
                    >
                      <ExternalLinkIcon className="mr-2 h-4 w-4" />
                      Open source {inspectorSheet?.number ?? "drawing"}
                    </Link>
                  </Button>
                )}
              {inspect.warnings.length > 0 && (
                <div className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
                  {inspect.warnings.map((warning, index) => (
                    <p key={index}>{warning}</p>
                  ))}
                </div>
              )}
              <Field label="Line notes">
                <Textarea
                  value={inspect.notes}
                  disabled={disabled}
                  onChange={(event) =>
                    update(inspect.id, { notes: event.target.value })
                  }
                  rows={3}
                />
              </Field>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  className="h-auto min-h-11 whitespace-normal sm:mr-2"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => {
                    setInspectId(null);
                    onAssignMaterial(inspect.id);
                  }}
                >
                  Assign catalogue material
                </Button>
                <Button
                  className={cn(
                    actionClass,
                    "h-auto min-h-11 whitespace-normal",
                  )}
                  disabled={disabled}
                  onClick={() => {
                    onSelected([inspect.id]);
                    onApprove([inspect.id]);
                  }}
                >
                  I reviewed this evidence
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
