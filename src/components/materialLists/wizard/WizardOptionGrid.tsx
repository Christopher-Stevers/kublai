"use client";

import type { CSSProperties, ReactNode } from "react";
import { Card, CardContent } from "~/components/ui/card";
import {
  ListPagination,
  type UseClientPaginationResult,
} from "~/components/ui/list-pagination";

// The cards gather as close to the middle as possible: the block is as
// square as the count allows (4 cards → 2×2, 9 → 3×3), up to 3 columns on a
// phone and 6 on wide screens, centred, with a short last row centred too.
// Every card keeps one size, a share of the full width (100cqw of the
// @container scroll area), whatever the column count.
// wizard-option-grid: Add Parts centres this block vertically under the heading.
export const WIZARD_OPTION_GRID_CLASS = [
  "wizard-option-grid mx-auto flex w-full flex-wrap justify-center gap-[var(--gap)]",
  "[--gap:0.5rem] sm:[--gap:0.75rem]",
  "[--card-w:calc((100cqw-2*var(--gap))/3)] sm:[--card-w:calc((100cqw-3*var(--gap))/4)] md:[--card-w:calc((100cqw-4*var(--gap))/5)] lg:[--card-w:calc((100cqw-5*var(--gap))/6)]",
  "[--c1:3] [--c2:4] [--c3:5] [--c4:6] [--cols:var(--c1)] sm:[--cols:var(--c2)] md:[--cols:var(--c3)] lg:[--cols:var(--c4)]",
  "max-w-[calc(var(--cols)*var(--card-w)+(var(--cols)-1)*var(--gap))]",
].join(" ");
export const WIZARD_OPTION_ITEM_SIZE_CLASS =
  "h-[4.5rem] w-[var(--card-w)] shrink-0 sm:h-20";

/** Column counts per screen size for `count` cards: as square as possible. */
export function wizardOptionGridStyle(count: number): CSSProperties {
  const square = Math.max(1, Math.ceil(Math.sqrt(count)));
  return {
    "--c1": Math.min(square, 3),
    "--c2": Math.min(square, 4),
    "--c3": Math.min(square, 5),
    "--c4": Math.min(square, 6),
  } as CSSProperties;
}
export const WIZARD_OPTION_CARD_CLASS = `${WIZARD_OPTION_ITEM_SIZE_CLASS} cursor-pointer justify-center gap-0 py-0 transition-all hover:shadow-md`;
/** The one line on each card: its name, bold. */
export const WIZARD_OPTION_LABEL_CLASS =
  "line-clamp-2 text-sm leading-snug font-bold break-words sm:text-base";
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
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
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
