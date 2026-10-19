const CONTROLS =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="combobox"], [role="listbox"], [role="menu"], [role="menubar"], [role="slider"], [role="spinbutton"], [role="radiogroup"], [role="tablist"], [role="tree"], [role="grid"]';

export function shortcutElementAvailable(element: Element) {
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
}

export function activeShortcutDialog() {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
    .filter(
      (element) =>
        element.getAttribute("data-state") !== "closed" &&
        shortcutElementAvailable(element),
    )
    .at(-1);
}

/** Keep native editing, IME, modifier shortcuts and popup navigation intact. */
export function keyboardShortcutBlocked(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey
  )
    return true;
  const target = event.composedPath().find((item) => item instanceof Element);
  if (
    (target instanceof Element && target.closest(CONTROLS)) ||
    document.activeElement?.closest(CONTROLS)
  )
    return true;
  return [...document.querySelectorAll('[role="menu"], [role="listbox"]')].some(
    (element) =>
      element.getAttribute("data-state") !== "closed" &&
      shortcutElementAvailable(element),
  );
}
