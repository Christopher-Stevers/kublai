"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { drawingKeysActive } from "~/components/jobs/useDrawingKeyboardControls";
import { activeShortcutDialog } from "~/lib/keyboard-shortcuts";
import { onHeaderBackRun, runHeaderBackOverride } from "~/lib/header-back-events";
import {
  currentItem,
  focusItem,
  pressItem,
  releasePress,
  navigableItems,
  nextItem,
  openPopupMenu,
  rightClick,
  typingTarget,
  type ArrowDirection,
} from "~/lib/keyboard-navigation";

const ARROWS: Record<string, ArrowDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

// Pages left with the back arrow, newest last, for D to return to.
const forward: string[] = [];
let leaving: { from: string; at: number } | null = null;
let returning: string | null = null;

const here = () => location.pathname + location.search;
const arcOpen = () => Boolean(document.querySelector("[data-arc-scroller]"));

/** Test hook: forget the forward pages. */
export function resetKeyboardHistory() {
  forward.length = 0;
  leaving = null;
  returning = null;
}

function KeyboardNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams()?.toString();

  useEffect(() => onHeaderBackRun(() => (leaving = { from: here(), at: Date.now() })), []);

  // Going back stacks the page for D; going anywhere new forgets the stack.
  useEffect(() => {
    const url = here();
    const back = leaving && Date.now() - leaving.at < 5000 ? leaving : null;
    if (back && url !== back.from) {
      if (forward.at(-1) !== back.from) forward.push(back.from);
    } else if (returning === url) {
      forward.pop();
    } else if (!back) {
      forward.length = 0;
    }
    leaving = null;
    returning = null;
  }, [pathname, search]);

  useEffect(() => {
    const blocked = (event: KeyboardEvent) =>
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      typingTarget(event);
    // Arrows are taken before the focused control sees them, so a dropdown or
    // list only opens with W, never on the way past.
    const arrow = (event: KeyboardEvent) => {
      const direction = ARROWS[event.key];
      if (!direction || blocked(event) || openPopupMenu() || arcOpen()) return;
      if (document.activeElement?.closest("[data-own-arrows]")) return;
      if (window.getSelection()?.isCollapsed === false) return;
      event.preventDefault();
      event.stopPropagation();
      const items = navigableItems();
      const next = nextItem(currentItem(items), direction, items);
      if (next) focusItem(next);
    };
    let held: HTMLElement | null = null;
    const release = (event: KeyboardEvent) => {
      if (!held || event.key.toLowerCase() !== "w") return;
      const item = held;
      held = null;
      event.preventDefault();
      releasePress(item);
    };
    // Leaving the window mid-hold must not leave the item pressed.
    const cancel = () => {
      if (held) releasePress(held, true);
      held = null;
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        typingTarget(event)
      )
        return;
      if (openPopupMenu()) {
        // Menus move with the arrows themselves; W picks and A closes.
        const press = { w: "Enter", a: "Escape" }[event.key.toLowerCase()];
        if (!press || event.repeat) return;
        event.preventDefault();
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent("keydown", { key: press, bubbles: true, cancelable: true }),
        );
        return;
      }
      const letter = event.key.toLowerCase();
      if (letter.length !== 1 || !"wasd".includes(letter)) return;
      // A drawing sheet on screen pans with W A S D.
      if (drawingKeysActive()) return;
      event.preventDefault();
      if (event.repeat) return;
      if (letter === "w") {
        const check = document.querySelector<HTMLButtonElement>("[data-arc-scroller] [data-arc-check]");
        if (check) {
          if (!check.disabled) check.click();
          return;
        }
        const item = currentItem();
        if (item) {
          // Held down until W comes up, so holding W is a long press.
          if (pressItem(item)) held = item;
        } else {
          const first = nextItem(null, "down");
          if (first) focusItem(first);
        }
      } else if (letter === "s") {
        if (arcOpen()) return;
        const target =
          currentItem() ??
          document.elementFromPoint(innerWidth / 2, innerHeight / 2) ??
          document.querySelector("main");
        if (target) rightClick(target);
      } else if (letter === "a") {
        // In a dialog, back closes it, as Escape does.
        const dialog = activeShortcutDialog();
        if (dialog)
          (document.activeElement ?? dialog).dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
          );
        else runHeaderBackOverride();
      } else {
        const target = forward.at(-1);
        if (!target) return router.forward();
        returning = target;
        router.push(target);
      }
    };
    window.addEventListener("keydown", arrow, true);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", release);
    window.addEventListener("blur", cancel);
    return () => {
      cancel();
      window.removeEventListener("keydown", arrow, true);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", release);
      window.removeEventListener("blur", cancel);
    };
  }, [router]);
  return null;
}

/**
 * Keyboard use of the whole app: the arrow keys move between the page's items,
 * W clicks the chosen one, S right-clicks it, A is the back arrow and D goes
 * forward again to a page left with it.
 */
export function AppKeyboardNavigation() {
  return (
    <Suspense fallback={null}>
      <KeyboardNavigation />
    </Suspense>
  );
}
