import { startDatabaseTimer } from "./query-stats";

/**
 * Preserve postgres-js's lazy Query and its values()/raw() modifiers. Attaching
 * a normal `.then()` while constructing a query would start it too early.
 * Only observe the public execution methods; never inspect SQL or parameters.
 */
function timedQuery<T extends object>(query: T): T {
  let started = false;
  const proxy = new Proxy(query, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (
          !started &&
          ["then", "catch", "finally", "execute", "forEach"].includes(
            String(key),
          )
        ) {
          started = true;
          const finish = startDatabaseTimer();
          // Native Promise.then does not execute a lazy postgres-js Query.
          void Promise.prototype.then.call(target, finish, finish);
        }
        const result: unknown = Reflect.apply(value, target, args);
        return result === target ? proxy : result;
      };
    },
  });
  return proxy;
}

/** Drizzle uses unsafe() and transaction clients, including nested savepoints. */
export function timedPostgresClient<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      const call = value as (...args: unknown[]) => unknown;
      if (key === "unsafe") {
        return (...args: unknown[]) =>
          timedQuery(Reflect.apply(call, target, args) as object);
      }
      if (key === "begin" || key === "savepoint") {
        return (...args: unknown[]) =>
          Reflect.apply(
            call,
            target,
            args.map((arg) =>
              typeof arg === "function"
                ? (transaction: object) =>
                    (arg as (client: object) => unknown)(
                      timedPostgresClient(transaction),
                    )
                : arg,
            ),
          );
      }
      return call.bind(target);
    },
  });
}
