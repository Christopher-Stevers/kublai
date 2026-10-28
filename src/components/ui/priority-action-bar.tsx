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
import { MoreHorizontalIcon } from "lucide-react";
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

export function PriorityActionBar({
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
