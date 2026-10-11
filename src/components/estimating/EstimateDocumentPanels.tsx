"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import type { EstimateDocument, EstimatingSettings } from "~/lib/estimating";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { actionClass, Field, NumberInput, selectClass } from "./estimating-ui";

export function EstimateSettings({
  document,
  disabled,
  onChange,
}: {
  document: EstimateDocument;
  disabled: boolean;
  onChange: (document: EstimateDocument) => void;
}) {
  const settings = document.settings;
  const set = (patch: Partial<EstimatingSettings>) =>
    onChange({ ...document, settings: { ...settings, ...patch } });
  const numbers: {
    key:
      | "laborRate"
      | "laborBurdenPercent"
      | "productivityFactor"
      | "overheadPercent"
      | "contingencyPercent"
      | "profitPercent"
      | "taxPercent";
    label: string;
    hint: string;
  }[] = [
    {
      key: "laborRate",
      label: "Base labor rate / hour",
      hint: "Used unless a cost row overrides the rate.",
    },
    {
      key: "laborBurdenPercent",
      label: "Labor burden %",
      hint: "Adds benefits, payroll costs, and other labor burden.",
    },
    {
      key: "productivityFactor",
      label: "Productivity factor",
      hint: "Multiplies hours. 1.2 means 20% more time.",
    },
    {
      key: "overheadPercent",
      label: "Overhead %",
      hint: "Applied to direct costs.",
    },
    {
      key: "contingencyPercent",
      label: "Contingency %",
      hint: "Applied after overhead.",
    },
    {
      key: "profitPercent",
      label:
        settings.profitMode === "margin"
          ? "True profit margin %"
          : "Profit markup %",
      hint:
        settings.profitMode === "margin"
          ? "Selling price = cost ÷ (1 − margin). Maximum 95%."
          : "Adds this percentage to cost after contingency.",
    },
    {
      key: "taxPercent",
      label: "Sales tax %",
      hint: "Applied to your chosen tax basis.",
    },
  ];
  return (
    <section className="p-5 sm:p-6">
      <h2 className="mb-1 text-base font-semibold">Pricing settings</h2>
      <p className="text-muted-foreground mb-6 text-sm">
        Rates and adjustments recalculate every included cost row.
      </p>
      <div className="grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
        <Field label="Estimate currency">
          <select
            value={settings.currency}
            disabled={disabled}
            className={selectClass}
            onChange={(event) =>
              set({
                currency: event.target.value as EstimatingSettings["currency"],
              })
            }
          >
            {["CAD", "USD", "GBP", "EUR"].map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </Field>
        {numbers.slice(0, 5).map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <NumberInput
              className="bg-background h-9 border text-left"
              value={settings[field.key]}
              disabled={disabled}
              max={
                field.key === "productivityFactor"
                  ? 100
                  : field.key === "laborRate"
                    ? 100_000_000
                    : 1000
              }
              min={field.key === "productivityFactor" ? 0.01 : 0}
              onChange={(value) =>
                set({
                  [field.key]:
                    field.key === "productivityFactor"
                      ? Math.max(0.01, value ?? 1)
                      : (value ?? 0),
                })
              }
            />
          </Field>
        ))}
        <Field label="Profit calculation">
          <select
            value={settings.profitMode}
            disabled={disabled}
            className={selectClass}
            onChange={(event) =>
              set({
                profitMode: event.target
                  .value as EstimatingSettings["profitMode"],
              })
            }
          >
            <option value="margin">True margin on selling price</option>
            <option value="markup">Markup on cost</option>
          </select>
        </Field>
        {numbers.slice(5).map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <NumberInput
              className="bg-background h-9 border text-left"
              value={settings[field.key]}
              disabled={disabled}
              max={field.key === "profitPercent" ? 95 : 1000}
              onChange={(value) =>
                set({
                  [field.key]:
                    field.key === "profitPercent"
                      ? Math.min(95, value ?? 0)
                      : (value ?? 0),
                })
              }
            />
          </Field>
        ))}
        <Field label="Tax basis">
          <select
            value={settings.taxBasis}
            disabled={disabled}
            className={selectClass}
            onChange={(event) =>
              set({
                taxBasis: event.target.value as EstimatingSettings["taxBasis"],
              })
            }
          >
            <option value="all">Entire selling subtotal</option>
            <option value="materials">Materials only</option>
          </select>
        </Field>
      </div>
    </section>
  );
}

export function EstimateProposal({
  document,
  disabled,
  onChange,
}: {
  document: EstimateDocument;
  disabled: boolean;
  onChange: (document: EstimateDocument) => void;
}) {
  const texts: {
    key: "scope" | "inclusions" | "exclusions" | "assumptions" | "notes";
    label: string;
    hint: string;
  }[] = [
    {
      key: "scope",
      label: "Scope of work",
      hint: "Describe the work included in the base bid.",
    },
    {
      key: "inclusions",
      label: "Inclusions",
      hint: "Materials, labor, equipment, coordination, and deliverables included.",
    },
    {
      key: "exclusions",
      label: "Exclusions",
      hint: "Work by others, allowances, and items excluded from the bid.",
    },
    {
      key: "assumptions",
      label: "Assumptions & drawing limitations",
      hint: "State pricing conditions and unresolved source limitations.",
    },
    {
      key: "notes",
      label: "Proposal notes",
      hint: "Payment terms, schedule, qualifications, and customer-facing notes.",
    },
  ];
  return (
    <section className="p-5 sm:p-6">
      <h2 className="mb-1 text-base font-semibold">Proposal scope</h2>
      <p className="text-muted-foreground mb-6 text-sm">
        These details appear on the customer proposal.
      </p>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Field label="Customer name">
          <Input
            value={document.customerName}
            disabled={disabled}
            maxLength={300}
            onChange={(event) =>
              onChange({ ...document, customerName: event.target.value })
            }
          />
        </Field>
        <Field label="Customer email">
          <Input
            type="email"
            value={document.customerEmail}
            disabled={disabled}
            maxLength={300}
            onChange={(event) =>
              onChange({ ...document, customerEmail: event.target.value })
            }
          />
        </Field>
        <Field label="Valid until">
          <Input
            type="date"
            value={document.validUntil}
            disabled={disabled}
            onChange={(event) =>
              onChange({ ...document, validUntil: event.target.value })
            }
          />
        </Field>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {texts.map((field) => (
          <Field key={field.key} label={field.label} hint={field.hint}>
            <Textarea
              value={document[field.key]}
              disabled={disabled}
              rows={field.key === "scope" ? 6 : 5}
              maxLength={20000}
              onChange={(event) =>
                onChange({ ...document, [field.key]: event.target.value })
              }
            />
          </Field>
        ))}
      </div>
    </section>
  );
}

export function EstimateAlternates({
  document,
  disabled,
  onChange,
}: {
  document: EstimateDocument;
  disabled: boolean;
  onChange: (document: EstimateDocument) => void;
}) {
  return (
    <section className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 text-base font-semibold">
            Alternate bid options
          </h2>
          <p className="text-muted-foreground mb-6 text-sm">
            Assign rows to an option in the cost table. Included options
            contribute to the selling price.
          </p>
        </div>
        <Button
          size="sm"
          className={actionClass}
          disabled={disabled}
          onClick={() =>
            onChange({
              ...document,
              alternates: [
                ...document.alternates,
                {
                  id: crypto.randomUUID(),
                  name: `Option ${document.alternates.length + 1}`,
                  included: false,
                },
              ],
            })
          }
        >
          <PlusIcon className="mr-1.5 h-4 w-4" />
          Add option
        </Button>
      </div>
      <div className="divide-y">
        {document.alternates.map((alternate) => (
          <div
            key={alternate.id}
            className="flex flex-wrap items-center gap-3 py-3"
          >
            <Input
              aria-label="Alternate option name"
              value={alternate.name}
              className="min-w-40 flex-1"
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...document,
                  alternates: document.alternates.map((item) =>
                    item.id === alternate.id
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                })
              }
            />
            <span className="text-muted-foreground text-xs">
              {
                document.lines.filter(
                  (line) => line.alternateId === alternate.id,
                ).length
              }{" "}
              rows
            </span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={alternate.included}
                onChange={(event) =>
                  onChange({
                    ...document,
                    alternates: document.alternates.map((item) =>
                      item.id === alternate.id
                        ? { ...item, included: event.target.checked }
                        : item,
                    ),
                  })
                }
              />
              Include in bid
            </label>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete alternate ${alternate.name}`}
              disabled={disabled}
              onClick={() =>
                onChange({
                  ...document,
                  alternates: document.alternates.filter(
                    (item) => item.id !== alternate.id,
                  ),
                  lines: document.lines.map((line) =>
                    line.alternateId === alternate.id
                      ? { ...line, alternateId: null, reviewStatus: "excluded" }
                      : line,
                  ),
                })
              }
            >
              <Trash2Icon className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      {!document.alternates.length && (
        <p className="text-muted-foreground border-y py-10 text-center text-sm">
          No alternate options. The estimate currently contains the base bid
          only.
        </p>
      )}
    </section>
  );
}
