"use client";

import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { ChevronUpIcon, MoreHorizontalIcon } from "lucide-react";
import { Button } from "./button";
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

/** At most this many actions show; the rest wait on the shelf. */
export const ACTION_LIMIT = 3;

/**
 * The app's bottom bar: at most three actions, highest priority on the right,
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
  ...props
}: HTMLAttributes<HTMLDivElement> & { label?: ReactNode }) {
  const actions = actionList(children);
  const shelved = actions.length > ACTION_LIMIT ? actions.length - ACTION_LIMIT : 0;
  const shown = actions.slice(shelved);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ y: number; dy: number } | null>(null);
  const shelfId = useId();
  const expanded = open && shelved > 0;

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
    <div
      ref={root}
      data-bottom-menu
      data-action-bar
      {...props}
      className={cn("relative w-full", className)}
    >
      {shelved > 0 && (
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
            if (swipe.current) swipe.current.dy = event.clientY - swipe.current.y;
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
      {/* Keep shelved controls mounted: opening their dialog must not destroy
          local state when the shelf lowers. */}
      <div
        id={shelfId}
        role="group"
        aria-label="More actions"
        hidden={!expanded}
        data-action-bar-shelf
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
            slot(action, index, index ? undefined : ACTION_LIMIT - ((shelved - 1) % ACTION_LIMIT)),
          )}
      </div>
      {label != null && label !== false && (
        <div data-action-bar-label>{label}</div>
      )}
      <div
        data-action-bar-row
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
      >
        {shown.map((action, index) => slot(action, index))}
      </div>
    </div>
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
      {...props}
      className={cn("relative grid w-full gap-1.5", className)}
      style={{
        ...props.style,
        gridTemplateColumns: `repeat(${overflowCount ? 4 : actions.length}, minmax(0, 1fr))`,
      }}
    >
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
