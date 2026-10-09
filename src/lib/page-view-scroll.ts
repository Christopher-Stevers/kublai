import type { SnapshotState } from "./snapshot-source";

/** Structural selectors survive a fresh render without relying on React IDs. */
function pathTo(element: Element) {
  const parts: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.body) {
    const tag = node.tagName.toLowerCase();
    const siblings: Element[] = [
      ...(node.parentElement?.children ?? []),
    ].filter((item) => item.tagName === node!.tagName);
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
    node = node.parentElement;
  }
  return `body > ${parts.join(" > ")}`;
}
export function capturePageScrolls(): NonNullable<SnapshotState["scrolls"]> {
  return [
    ...document.querySelectorAll<HTMLElement>("main *, [role='dialog'] *"),
  ]
    .filter(
      (node) =>
        (node.scrollTop > 0 || node.scrollLeft > 0) &&
        !node.closest("[data-snapshot-ui]") &&
        !node.matches("input,textarea,select"),
    )
    .slice(0, 20)
    .map((node) => ({
      path: pathTo(node),
      x: Math.max(0, node.scrollLeft),
      y: Math.max(0, node.scrollTop),
    }))
    .filter((item) => item.path.length <= 1000);
}
export function restorePageScrolls(
  scrolls: NonNullable<SnapshotState["scrolls"]>,
) {
  let complete = true;
  for (const { path, x, y } of scrolls) {
    const node = document.querySelector<HTMLElement>(path);
    if (!node) {
      complete = false;
      continue;
    }
    node.scrollLeft = x;
    node.scrollTop = y;
    if (Math.abs(node.scrollLeft - x) > 1 || Math.abs(node.scrollTop - y) > 1)
      complete = false;
  }
  return complete;
}
