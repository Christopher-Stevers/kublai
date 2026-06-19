"use client";

import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { ListPagination, type UseClientPaginationResult } from "~/components/ui/list-pagination";

export const WIZARD_OPTION_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(min(1.35in,100%),1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(1.5in,100%),1fr))] sm:gap-3";
export const WIZARD_OPTION_CARD_CLASS = "w-full max-w-[4in] cursor-pointer transition-all hover:shadow-md";
export const WIZARD_OPTION_SELECTED_CLASS = "border-primary border-2 shadow-md";

export function WizardOptionCard({
  selected = false,
  onClick,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      className={`${WIZARD_OPTION_CARD_CLASS} ${selected ? WIZARD_OPTION_SELECTED_CLASS : ""}`}
      onClick={onClick}
    >
      <CardContent className="p-2 text-center sm:p-4">{children}</CardContent>
    </Card>
  );
}

export function PartCount({ count }: { count?: number }) {
  if (count === undefined || count <= 0) return null;

  return (
    <p className="mt-1 text-xs text-gray-500">
      {count} part{count !== 1 ? "s" : ""}
    </p>
  );
}

export function WizardAllOption({
  selected,
  onSelect,
  label = "All",
}: {
  selected?: boolean;
  onSelect: () => void;
  label?: string;
}) {
  return (
    <WizardOptionCard selected={selected} onClick={onSelect}>
      <p className="text-sm font-medium sm:text-base">{label}</p>
    </WizardOptionCard>
  );
}

export function CustomOptionForm({
  value,
  placeholder,
  buttonLabel,
  pendingLabel = "Adding...",
  isPending = false,
  onChange,
  onSubmit,
}: {
  value: string;
  placeholder: string;
  buttonLabel: string;
  pendingLabel?: string;
  isPending?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const disabled = !value.trim() || isPending;

  return (
    <div className="mt-3 flex flex-col gap-2 sm:mt-4 sm:flex-row">
      <Input
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !disabled) {
            onSubmit();
          }
        }}
        className="flex-1 text-sm sm:text-base"
        autoFocus
        disabled={isPending}
      />
      <Button
        onClick={onSubmit}
        disabled={disabled}
        className="w-full text-xs sm:w-auto sm:text-sm"
      >
        {isPending ? pendingLabel : buttonLabel}
      </Button>
    </div>
  );
}

export function WizardOptionPagination<T>({
  pagination,
  itemLabel,
}: {
  pagination: UseClientPaginationResult<T>;
  itemLabel: string;
}) {
  return (
    <ListPagination
      page={pagination.page}
      totalPages={pagination.totalPages}
      totalItems={pagination.totalItems}
      startItem={pagination.startItem}
      endItem={pagination.endItem}
      itemLabel={itemLabel}
      onPageChange={pagination.setPage}
    />
  );
}
