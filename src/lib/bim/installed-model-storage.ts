import { isStandaloneApp } from "~/lib/install-prompt";

let requested = false;
/** Detect the window actually in use, not whether installation exists elsewhere. */
export function installedModelStorage(): boolean {
  if (!isStandaloneApp()) return false;
  if (!requested) {
    requested = true;
    void (async () => {
      try {
        if (
          navigator.storage?.persist &&
          !(await navigator.storage.persisted())
        )
          await navigator.storage.persist();
      } catch {
        // Some browsers deny persistence; ordinary app storage still works.
      }
    })();
  }
  return true;
}
