/** Browser-side diagnostic only. Serialized directly into page.evaluate; no
 * imports/closures, polling, application writes or per-control visibility walk. */
export function installMaterialReadiness(expectedPathname) {
  const d = { pointerdown: [], click: [], ready: null, observerChecks: 0 };
  let observer;
  const observe = () => {
    if (d.ready !== null || location.pathname !== expectedPathname) return;
    d.observerChecks++;
    const first = document.querySelector('button[aria-label="Increase quantity"]');
    if (!first?.isConnected || getComputedStyle(first).visibility !== "visible") return;
    // One geometry read, for the same first exact control as the driver locator.
    const rect = first.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    d.ready = { at: performance.now(), firstExactControlVisible: true };
    performance.mark("material-cpu:ready");
    observer.disconnect();
  };
  const pointer = event => {
    if (event.isTrusted) { d.pointerdown.push(performance.now()); performance.mark("material-cpu:pointerdown"); }
  };
  const click = event => {
    if (event.isTrusted) { d.click.push(performance.now()); performance.mark("material-cpu:click"); }
  };
  observer = new MutationObserver(observe);
  observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  document.addEventListener("pointerdown", pointer, true);
  document.addEventListener("click", click, true);
  window.__materialCpu = {
    // Called only after CPU/trace stop; this deliberately expensive inventory is
    // not part of readiness or the captured interval.
    finish: () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("click", click, true);
      return { ...d, quantityCount: [...document.querySelectorAll('button[aria-label="Increase quantity"]')].filter(element => {
        const rect = element.getBoundingClientRect();
        return getComputedStyle(element).visibility === "visible" && rect.width > 0 && rect.height > 0;
      }).length };
    },
  };
}
