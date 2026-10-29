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
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type CSSProperties,
  type RefObject,
  type ReactNode,
} from "react";
import {
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

/** Phone bars show at most this many actions; the rest wait on the shelf. */
export const ACTION_LIMIT = 3;
/** Wider bars show one more action per this many pixels, up to the maximum. */
const ACTION_MIN_WIDTH = 128;
const ACTION_MAX = 6;

const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** How many actions fit in the bar: three on a phone, more on wider bars. */
function useActionLimit(root: RefObject<HTMLDivElement | null>) {
  const [limit, setLimit] = useState(ACTION_LIMIT);
  useIsoLayoutEffect(() => {
    const element =
      root.current?.querySelector<HTMLElement>("[data-action-bar-row]") ??
      root.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const fit = Math.floor(element.clientWidth / ACTION_MIN_WIDTH);
      setLimit(Math.min(ACTION_MAX, Math.max(ACTION_LIMIT, fit)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [root]);
  return limit;
}

/** A search that lives in the bottom bar. Put `<BarSearchButton />` among the
 * actions; tapping it widens the search field across the whole bar, and its X
 * clears the search and brings the buttons back. */
export type BarSearch = {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
};

const BarSearchContext = createContext<{
  value: string;
  open: () => void;
} | null>(null);

export function BarSearchButton({ className }: { className?: string }) {
  const search = useContext(BarSearchContext);
  if (!search) return null;
  const value = search.value.trim();
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      data-bar-search-button
      onClick={search.open}
    >
      <SearchIcon />
      <span className="truncate">{value ? `“${value}”` : "Search"}</span>
    </Button>
  );
}

/**
 * The app's bottom bar: three actions on a phone, more on wider bars (one per
 * 128px, up to six), highest priority on the right,
 * each the same height in the same type. Lower priorities wait on a shelf
 * behind a tab on the bar's top edge; tap the tab or swipe it up to raise the
 * shelf. `label` is the line above the buttons (a total, a status, the order
 * being received), drawn in one style on every screen. The bar's container
 * should have the standard 0.5rem top padding so the tab sits on its border.
 */
export function PriorityActionBar({
  children,
  className,
  label,
  search,
  dismissOnBack = false,
  tabAction,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: ReactNode; search?: BarSearch; dismissOnBack?: boolean; /** Replaces More for bars whose actions all fit. */ tabAction?: ReactNode }) {
  const actions = actionList(children);
  const root = useRef<HTMLDivElement>(null);
  const limit = useActionLimit(root);
  const shelved = actions.length > limit ? actions.length - limit : 0;
  const shown = actions.slice(shelved);
  const [open, setOpen] = useState(false);
  const tab = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ y: number; dy: number } | null>(null);
  const shelfId = useId();
  const [searching, setSearching] = useState(() => !!search?.value);
  const searchButton = useRef(false);
  const expanded = open && shelved > 0 && !searching;
  useHeaderBackOverride(dismissOnBack && (expanded || searching) ? () => {
    setOpen(false);
    setSearching(false);
  } : null, { priority: 110 });

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

  if (!actions.length) return null;
  const closeSearch = () => {
    search?.onChange("");
    searchButton.current = true;
    setSearching(false);
  };
  const slot = (action: ReactNode, index: number, column?: number) => (
    <div
      data-action-slot
      key={isValidElement(action) ? (action.key ?? index) : index}
      style={column ? { gridColumnStart: column } : undefined}
    >
      {action}
    </div>
  );
  return (
    <BarSearchContext.Provider
      value={
        search ? { value: search.value, open: () => setSearching(true) } : null
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
        {!tabAction && shelved > 0 && !searching && (
          <button
            ref={tab}
            type="button"
            data-action-bar-tab
            data-count={shelved}
            aria-expanded={expanded}
            aria-controls={shelfId}
            title={`${shelved} more ${shelved === 1 ? "action" : "actions"}`}
            className="touch-none"
            onPointerDown={(event) => {
              swipe.current = { y: event.clientY, dy: 0 };
            }}
            onPointerMove={(event) => {
              if (swipe.current)
                swipe.current.dy = event.clientY - swipe.current.y;
            }}
            onClick={() => {
              // A swipe up raises the shelf and a swipe down lowers it; a tap
              // or a key toggles it.
              const dy = swipe.current?.dy ?? 0;
              swipe.current = null;
              setOpen(Math.abs(dy) > 12 ? dy < 0 : !expanded);
            }}
          >
            <ChevronUpIcon aria-hidden />
            More
          </button>
        )}
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
          {/* Right-aligned like the bar below: a part row goes on top, so the
            highest shelved actions sit just above the bar. */}
          {actions
            .slice(0, shelved)
            .map((action, index) =>
              slot(
                action,
                index,
                index ? undefined : limit - ((shelved - 1) % limit),
              ),
            )}
        </div>
        {label != null && label !== false && (
          <div data-action-bar-label>{label}</div>
        )}
        <div data-landscape-action-row>
          <div data-landscape-navigation-slot />
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
          {/* Hidden, not removed, while searching: the bar measures this row. */}
          <div
            data-action-bar-row
            hidden={!!search && searching}
            style={{
              gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`,
            }}
          >
            {shown.map((action, index) => slot(action, index))}
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
