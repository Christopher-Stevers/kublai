import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const supportedVersion = "3.4.8";
type RecordEntry = {
  wrapped: (...args: unknown[]) => unknown;
  listeners: Set<() => void>;
};
const shared = globalThis as typeof globalThis & {
  __foremanListenLifecycle?: WeakMap<object, RecordEntry>;
};
const registry = (shared.__foremanListenLifecycle ??= new WeakMap());
/** No private data is read: only the resolved driver's package metadata. A
 * bundled/unresolvable/changed driver is unsupported and keeps HTTP fallback. */
export function installedPostgresVersion(): string | null {
  try {
    let directory = path.dirname(
      createRequire(import.meta.url).resolve("postgres"),
    );
    for (
      let depth = 0;
      depth < 4;
      depth++, directory = path.dirname(directory)
    ) {
      try {
        const value: unknown = JSON.parse(
          readFileSync(path.join(directory, "package.json"), "utf8"),
        );
        if (
          value &&
          typeof value === "object" &&
          "name" in value &&
          value.name === "postgres" &&
          "version" in value &&
          typeof value.version === "string"
        )
          return value.version;
      } catch {
        /* Parent may be cjs/src rather than package root. */
      }
    }
  } catch {
    /* Keep fallback. */
  }
  return null;
}
/** Version-pinned adapter for postgres-js listen.sql (private). The real LISTEN
 * pool overrides the outer onclose; wrapping any other pool would be wrong.
 * Validate every shape, preserve original this/args/return/throw and reconnect,
 * avoid stacking wrappers across hot reload. Never changes the outer pool. */
export function observeListenLoss(
  connection: unknown,
  version: string | null,
  lost: () => void,
): (() => void) | null {
  if (
    version !== supportedVersion ||
    !connection ||
    (typeof connection !== "object" && typeof connection !== "function")
  )
    return null;
  try {
    const listen: unknown = Reflect.get(connection, "listen");
    if (typeof listen !== "function") return null;
    const internal: unknown = Reflect.get(listen, "sql");
    if (!internal || internal === connection || typeof internal !== "function")
      return null;
    const options: unknown = Reflect.get(internal, "options");
    if (!options || typeof options !== "object") return null;
    const original: unknown = Reflect.get(options, "onclose");
    if (typeof original !== "function") return null;
    let entry = registry.get(options);
    if (entry) {
      if (original !== entry.wrapped) return null;
    } else {
      const listeners = new Set<() => void>();
      const wrapped = function (this: unknown, ...args: unknown[]) {
        for (const notify of listeners) {
          try {
            notify();
          } catch {
            /* Never interrupt driver reconnection. */
          }
        }
        return Reflect.apply(original, this, args) as unknown;
      };
      if (
        !Reflect.set(options, "onclose", wrapped) ||
        Reflect.get(options, "onclose") !== wrapped
      )
        return null;
      entry = { wrapped, listeners };
      registry.set(options, entry);
    }
    entry.listeners.add(lost);
    const listeners = entry.listeners;
    return () => {
      listeners.delete(lost);
    };
  } catch {
    return null;
  }
}
