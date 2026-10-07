"use client";

import type { ReactNode } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { ListPagination, type UseClientPaginationResult } from "~/components/ui/list-pagination";

// auto-rows-fr: every card in the grid is as tall as the tallest one.
export const WIZARD_OPTION_GRID_CLASS = "grid auto-rows-fr grid-cols-[repeat(auto-fill,minmax(min(1.35in,100%),1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(min(1.5in,100%),1fr))] sm:gap-3";
export const WIZARD_OPTION_CARD_CLASS = "h-full min-h-16 w-full max-w-[4in] cursor-pointer justify-center gap-0 py-0 transition-all hover:shadow-md";
/** The one line on each card: its name, bold. */
export const WIZARD_OPTION_LABEL_CLASS = "line-clamp-3 text-sm leading-snug font-bold break-words sm:text-base";
export const WIZARD_OPTION_SELECTED_CLASS = "border-primary border-2 shadow-md";

export function WizardOptionCard({
  selected = false,
  onClick,
  tutorialChoice,
  children,
}: {
  selected?: boolean;
  onClick: () => void;
  tutorialChoice?: string;
  children: ReactNode;
}) {
  return (
    <Card
      data-tutorial-choice={tutorialChoice}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onClick(); }
      }}
      className={`${WIZARD_OPTION_CARD_CLASS} ${selected ? WIZARD_OPTION_SELECTED_CLASS : ""}`}
      onClick={onClick}
    >
      <CardContent className="flex h-full items-center justify-center p-2 text-center sm:p-4">
        {children}
      </CardContent>
    </Card>
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
      <p className={WIZARD_OPTION_LABEL_CLASS}>{label}</p>
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
