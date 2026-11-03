import { activeShortcutDialog, shortcutElementAvailable } from "~/lib/keyboard-shortcuts";

export type ArrowDirection = "up" | "down" | "left" | "right";

const ITEMS = [
  "a[href]",
  "button",
  "summary",
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="option"]',
  '[role="menuitem"]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

// Typing, and canvases with their own key controls (the 3D model view).
const TYPING =
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, canvas, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="slider"], [role="spinbutton"]';

/** Keys that belong to text entry or to a control with its own key handling. */
export function typingTarget(event: KeyboardEvent) {
  const target = event.composedPath().find((item) => item instanceof Element);
  return Boolean(
    (target instanceof Element && target.closest(TYPING)) || document.activeElement?.closest(TYPING),
  );
}

export function openPopupMenu() {
  return [...document.querySelectorAll('[role="menu"], [role="listbox"]')].some(
    (element) => element.getAttribute("data-state") !== "closed" && shortcutElementAvailable(element),
  );
}

function usable(element: HTMLElement) {
  if (element.matches(":disabled, [aria-disabled='true']")) return false;
  if (element.closest("[data-arc-scroller], [data-key-nav-skip]")) return false;
  if (!shortcutElementAvailable(element)) return false;
  const rect = element.getBoundingClientRect();
  // Off to the side (a closed drawer) is out; above or below can scroll in.
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth;
}

/** The items the arrow keys move between: the open dialog's, or the page's. */
export function navigableItems() {
  const scope = activeShortcutDialog() ?? document.body;
  return [...scope.querySelectorAll<HTMLElement>(ITEMS)].filter(usable);
}

export function currentItem(items = navigableItems()) {
  const active = document.activeElement;
  return active instanceof HTMLElement && items.includes(active) ? active : null;
}

function firstItem(items: HTMLElement[]) {
  const onScreen = items.filter((item) => {
    const rect = item.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight;
  });
  // Start in the page itself rather than on the app bar.
  const page = onScreen.filter((item) => !item.closest("header"));
  const pool = page.length ? page : onScreen.length ? onScreen : items;
  return [...pool].sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return Math.abs(ra.top - rb.top) > 4 ? ra.top - rb.top : ra.left - rb.left;
  })[0];
}

/** Nearest item in a direction, favouring ones in line with the current one. */
export function nextItem(from: HTMLElement | null, direction: ArrowDirection, items = navigableItems()) {
  if (!from) return firstItem(items) ?? null;
  const a = from.getBoundingClientRect();
  const vertical = direction === "up" || direction === "down";
  const sign = direction === "down" || direction === "right" ? 1 : -1;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const item of items) {
    if (item === from || item.contains(from) || from.contains(item)) continue;
    const b = item.getBoundingClientRect();
    const along = vertical
      ? sign * (b.top + b.height / 2 - (a.top + a.height / 2))
      : sign * (b.left + b.width / 2 - (a.left + a.width / 2));
    // Its leading edge must move that way too: a wider item above whose
    // middle sits further right is not "to the right".
    const edge = vertical ? sign * (b.top - a.top) : sign * (b.left - a.left);
    if (along <= 2 || edge <= 2) continue;
    const gap = Math.max(
      0,
      vertical
        ? sign > 0 ? b.top - a.bottom : a.top - b.bottom
        : sign > 0 ? b.left - a.right : a.left - b.right,
    );
    const across = vertical
      ? Math.max(0, b.left - a.right, a.left - b.right)
      : Math.max(0, b.top - a.bottom, a.top - b.bottom);
    const offset = vertical
      ? Math.abs(b.left + b.width / 2 - (a.left + a.width / 2))
      : Math.abs(b.top + b.height / 2 - (a.top + a.height / 2));
    const score = gap + across * 3 + offset * 0.1 + along * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return best;
}

export function focusItem(item: HTMLElement) {
  for (const old of document.querySelectorAll("[data-key-focus]")) old.removeAttribute("data-key-focus");
  item.setAttribute("data-key-focus", "");
  item.addEventListener("blur", () => item.removeAttribute("data-key-focus"), { once: true });
  item.focus({ preventScroll: true, focusVisible: true } as FocusOptions);
  item.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

function centre(element: Element) {
  const rect = element.getBoundingClientRect();
  return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
}

function pointer(type: string, init: MouseEventInit & { pointerType?: string; isPrimary?: boolean }) {
  return typeof PointerEvent === "function" ? new PointerEvent(type, init) : new MouseEvent(type, init);
}

/** The same events a mouse's left click sends, for menus that open on press. */
export function leftClick(element: HTMLElement) {
  const base = { bubbles: true, cancelable: true, composed: true, button: 0, ...centre(element) };
  const press = { ...base, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true };
  element.dispatchEvent(pointer("pointerdown", press));
  element.dispatchEvent(new MouseEvent("mousedown", press));
  element.dispatchEvent(pointer("pointerup", { ...press, buttons: 0 }));
  element.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0 }));
  element.click();
}

/** A right click: opens the arc scroller, or the item's own context menu. */
export function rightClick(element: Element) {
  element.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, composed: true, button: 2, buttons: 2, ...centre(element),
    }),
  );
}
