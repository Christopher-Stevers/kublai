"use client";

import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  MoreHorizontalIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { Button } from "./button";
import { Input } from "./input";
import { cn } from "~/lib/utils";

/** Children form the priority list, lowest first / highest (rightmost) last.
 * Omit actions without permission before passing them here. Disabled means a
 * permitted action is temporarily unavailable, never a permission check.
 * Fragments and conditional children do not consume button slots. */
export function actionList(children: ReactNode, prefix = ""): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment
      ? actionList(child.props.children, `${prefix}${child.key}/`)
      : [
          isValidElement(child)
            ? cloneElement(child, { key: `${prefix}${child.key}` })
            : child,
        ],
  );
}

/** Main rows have three slots total, including the search/overflow control. */
export const ACTION_LIMIT = 3;

/** Search reserves one primary slot on every page. Its overflow arrow shares
 * that slot when there are extra actions. Tapping search opens a field
 * above the buttons; X clears and closes the field. */
export type BarSearch = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  /** Arrows before the X that move through the results. */
  step?: { onPrevious: () => void; onNext: () => void; disabled?: boolean };
};

const BarSearchContext = createContext<{
  value: string;
  label: string;
  open: () => void;
} | null>(null);

function BarSearchButton({
  className,
  iconOnly = false,
}: {
  className?: string;
  /** Just the symbol, named for screen readers, as in a split button. */
  iconOnly?: boolean;
}) {
  const search = useContext(BarSearchContext);
  if (!search) return null;
  const value = search.value.trim();
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      data-bar-search-button
      aria-label={iconOnly ? (value ? `${search.label}: ${value}` : search.label) : undefined}
      title={iconOnly ? search.label : undefined}
      onClick={search.open}
    >
      <SearchIcon />
      {!iconOnly && (
        <span className="truncate">{value ? `“${value}”` : "Search"}</span>
      )}
    </Button>
  );
}

/**
 * The app's bottom bar: three slots, including search/overflow, with the
 * search in the leftmost, third-priority slot and higher priority actions
 * to its right,
 * each the same height in the same type. An in-row arrow expands every extra
 * action above the primary row; there are no pages or nested overflow menus. `label` is the line above the buttons (a total, a status, the order
 * being received), drawn in one style on every screen. The bar's container
 * should have the standard 0.5rem top padding.
 */
export function PriorityActionBar({
  children,
  className,
  label,
  search,
  searchAction,
  dismissOnBack = false,
  tabAction,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  label?: ReactNode;
  search?: BarSearch;
  /** View action in the arrow half of Search; shelved if overflow is needed. */
  searchAction?: ReactNode;
  dismissOnBack?: boolean;
  /** Optional screen-specific view toggle above the action row. */ tabAction?: ReactNode;
}) {
  const actions = actionList(children);
  const root = useRef<HTMLDivElement>(null);
  const limit = ACTION_LIMIT;
  const hasSearch = !!search;
  const actionGroup = (action: ReactNode) =>
    isValidElement<{ "data-action-group"?: string }>(action)
      ? (action.props["data-action-group"] ?? "")
      : "";
  const primary = actions.filter(action => !actionGroup(action));
  const hasOverflow = primary.length !== actions.length || primary.length > limit - Number(hasSearch);
  const capacity = limit - Number(hasSearch || hasOverflow);
  const shown = primary.slice(-capacity);
  const overflow = actions.filter(action => !shown.includes(action));
  const inlineSearchAction = hasSearch && overflow.length === 0 ? searchAction : null;
  const shelf = hasSearch && overflow.length > 0 && searchAction
    ? [searchAction, ...overflow]
    : overflow;
  const shelved = shelf.length;
  // Named sections always stay in the expanded menu, preserving the primary slots.
  const shelfGroups = new Map<string, ReactNode[]>();
  for (const action of shelf) {
    const group = actionGroup(action);
    const items = shelfGroups.get(group) ?? [];
    items.push(action);
    shelfGroups.set(group, items);
  }

  const [open, setOpen] = useState(false);
  const tab = useRef<HTMLButtonElement>(null);
  const shelfId = useId();
  const [searching, setSearching] = useState(() => !!search?.value);
  const searchButton = useRef(false);
  const searchActive = !!search && searching;
  const expanded = open && shelved > 0;
  useHeaderBackOverride(
    dismissOnBack && (expanded || searchActive)
      ? () => {
          setOpen(false);
          setSearching(false);
        }
      : null,
    { priority: 110 },
  );

  useEffect(() => {
    // Back from the search: return focus to the Search button.
    if (searching || !searchButton.current) return;
    searchButton.current = false;
    root.current
      ?.querySelector<HTMLElement>("[data-bar-search-button]")
      ?.focus();
  }, [searching]);

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        tab.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  if (!actions.length && !search) return null;
  const closeSearch = () => {
    search?.onChange("");
    searchButton.current = true;
    setSearching(false);
  };
  const slot = (action: ReactNode, index: number, column?: number) => (
    <div
      data-action-slot
      style={column ? { gridColumn: column } : undefined}
      key={isValidElement(action) ? (action.key ?? index) : index}
    >
      {action}
    </div>
  );
  return (
    <BarSearchContext.Provider
      value={
        search
          ? {
              value: search.value,
              label: search.label,
              open: () => setSearching(true),
            }
          : null
      }
    >
      <div
        ref={root}
        data-bottom-menu
        data-action-bar
        {...props}
        className={cn("relative w-full", className)}
      >
        {tabAction}
        {/* In landscape the screen's second top bar moves in here. */}
        <div data-landscape-subbar-slot />
        {/* Keep shelved controls mounted: opening their dialog must not destroy
          local state when the shelf lowers. */}
        <div
          id={shelfId}
          role="group"
          aria-label="More actions"
          hidden={!expanded}
          data-action-bar-shelf
          style={{ gridTemplateColumns: `repeat(${limit}, minmax(0, 1fr))` }}
          onClick={(event) => {
            const button = (event.target as HTMLElement).closest("button");
            if (
              button &&
              !button.disabled &&
              !button.hasAttribute("aria-haspopup")
            ) {
              tab.current?.focus();
              setOpen(false);
            }
          }}
        >
          {[...shelfGroups].sort(([a], [b]) => Number(Boolean(a)) - Number(Boolean(b))).map(([group, items]) => group ? (
            <section key={group} aria-label={group} className="col-span-full grid gap-1.5 border-t pt-2" style={{ gridTemplateColumns: `repeat(${limit}, minmax(0, 1fr))` }}>
              <h3 className="text-muted-foreground col-span-full px-1 text-sm font-semibold">{group}</h3>
              {items.map((action, index) => slot(action, index))}
            </section>
          ) : items.map((action, index) => slot(action, index)))}
        </div>
        {label != null && label !== false && (
          <div data-action-bar-label>{label}</div>
        )}
        {search && searching && (
            <div data-action-bar-search>
              <div className="relative min-w-0 flex-1">
                <SearchIcon className="text-muted-foreground/70 pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  autoFocus
                  type="search"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label={search.label}
                  placeholder={search.placeholder ?? "Search"}
                  value={search.value}
                  onChange={(event) => search.onChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                    if (event.key === "Escape") closeSearch();
                  }}
                  className="h-full rounded-lg pl-9 [&::-webkit-search-cancel-button]:appearance-none"
                />
              </div>
              {search.step && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-(--action-height) shrink-0"
                    aria-label="Previous result"
                    disabled={search.step.disabled}
                    onClick={search.step.onPrevious}
                  >
                    <ChevronLeftIcon className="size-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="-ml-2 size-(--action-height) shrink-0"
                    aria-label="Next result"
                    disabled={search.step.disabled}
                    onClick={search.step.onNext}
                  >
                    <ChevronRightIcon className="size-5" />
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-(--action-height) shrink-0"
                aria-label="Close search"
                onClick={closeSearch}
              >
                <XIcon className="size-5" />
              </Button>
            </div>
          )}
        <div data-landscape-action-row>
          <div data-landscape-navigation-slot />
          <div
            data-action-bar-row
            style={{
              gridTemplateColumns: `repeat(${Math.max(1, shown.length + Number(hasSearch || shelved > 0))}, minmax(0, 1fr))`,
            }}
          >
            {search && (
              <div data-action-slot data-split-search key="split-search" style={{ gridColumn: 1 }}>
                <div>
                  {shelved > 0 && (
                    <Button
                      ref={tab}
                      type="button"
                      variant={expanded ? "default" : "outline"}
                      data-action-bar-expand
                      data-count={shelved}
                      aria-label={expanded ? "Collapse actions" : "Expand all actions"}
                      aria-expanded={expanded}
                      aria-controls={shelfId}
                      title={expanded ? "Collapse actions" : "Expand all actions"}
                      onClick={() => setOpen(!expanded)}
                    >
                      <ChevronUpIcon aria-hidden className={cn("transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
                    </Button>
                  )}
                  {inlineSearchAction}
                  <BarSearchButton iconOnly={shelved > 0 || !!inlineSearchAction} />
                </div>
              </div>
            )}
            {shelved > 0 && !hasSearch && (
              <div data-action-slot key="expand-actions">
                <Button
                  ref={tab}
                  type="button"
                  variant={expanded ? "default" : "outline"}
                  data-action-bar-expand
                  data-count={shelved}
                  aria-label={expanded ? "Collapse actions" : "Expand all actions"}
                  aria-expanded={expanded}
                  aria-controls={shelfId}
                  title={expanded ? "Collapse actions" : "Expand all actions"}
                  onClick={() => setOpen(!expanded)}
                >
                  <ChevronUpIcon aria-hidden className={cn("transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
                </Button>
              </div>
            )}
            {shown.map((action, index) =>
              slot(action, index, hasSearch ? index + 2 : undefined),
            )}
          </div>
        </div>
      </div>
    </BarSearchContext.Provider>
  );
}

/** The drawing viewer's tool bar: up to four tools, the rest under More, in
 * the viewer's own sizes. Everything else uses PriorityActionBar. */
export function ViewerActionBar({
  children,
  className,
  moreButtonClassName,
  ...props
}: HTMLAttributes<HTMLDivElement> & { moreButtonClassName?: string }) {
  const actions = actionList(children);
  const overflowCount = actions.length > 4 ? actions.length - 3 : 0;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const expanded = open && overflowCount > 0;

  useEffect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [expanded]);

  if (!actions.length) return null;
  return (
    <div
      ref={root}
      data-bottom-menu
      data-viewer-action-bar
      {...props}
      className={cn("relative grid w-full gap-1.5", className)}
      style={
        {
          ...props.style,
          "--viewer-action-count": overflowCount ? 4 : actions.length,
          gridTemplateColumns: `repeat(${overflowCount ? 4 : actions.length}, minmax(0, 1fr))`,
        } as CSSProperties
      }
    >
      <div data-landscape-navigation-slot />
      {overflowCount > 0 && (
        <Button
          ref={trigger}
          type="button"
          variant="outline"
          className={cn(
            "h-full min-h-9 w-full gap-1 px-1.5 text-xs",
            moreButtonClassName,
          )}
          aria-expanded={expanded}
          aria-controls={panelId}
          onClick={() => setOpen(!expanded)}
        >
          <MoreHorizontalIcon className="size-4 shrink-0" />
          More
        </Button>
      )}
      {/* Keep overflow controls mounted: opening their dialog must not destroy
          local state when the action tray closes. */}
      <div
        id={panelId}
        role="group"
        aria-label="More actions"
        hidden={!expanded}
        className="bg-popover absolute bottom-full left-0 z-50 mb-2 max-h-[60dvh] w-full min-w-0 overflow-y-auto rounded-xl border p-2 shadow-xl"
        onClick={(event) => {
          const button = (event.target as HTMLElement).closest("button");
          if (
            button &&
            !button.disabled &&
            !button.hasAttribute("aria-haspopup")
          ) {
            trigger.current?.focus();
            setOpen(false);
          }
        }}
      >
        <div className="grid gap-2">
          {actions.slice(0, overflowCount).map((action, index) => (
            <div
              className="min-w-0 [&>button]:w-full"
              key={isValidElement(action) ? (action.key ?? index) : index}
            >
              {action}
            </div>
          ))}
        </div>
      </div>
      {actions.slice(overflowCount).map((action, index) => (
        <div
          className="min-w-0 [&>button]:h-full [&>button]:w-full"
          key={isValidElement(action) ? (action.key ?? index) : index}
        >
          {action}
        </div>
      ))}
    </div>
  );
}
