import path from "node:path";
/** Inspect actual postgres-js public options before any query or connection. */
export function assertPrivateClientOptions(options, socket) {
  if (
    typeof socket !== "string" ||
    !/^\/tmp\/foremanhq-perf-pg\.[A-Za-z0-9]+$/.test(socket)
  )
    throw Error("Owned socket directory required");
  if (
    !options ||
    options.path !== path.join(socket, ".s.PGSQL.55463") ||
    !Array.isArray(options.host) ||
    options.host.length !== 1 ||
    options.host[0] !== socket ||
    !Array.isArray(options.port) ||
    options.port.length !== 1 ||
    options.port[0] !== 55463 ||
    options.database !== "foremanhq_perf_lab" ||
    options.ssl !== false
  )
    throw Error(
      "Actual application PostgreSQL client is not bound to owned socket/database",
    );
}
export function assertPrivateEnvironment(env, socket) {
  const url = new URL(env.DATABASE_URL);
  if (
    url.protocol !== "postgres:" ||
    url.hostname ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/foremanhq_perf_lab" ||
    env.PGHOST !== socket ||
    env.PGPORT !== "55463" ||
    env.PGDATABASE !== "foremanhq_perf_lab"
  )
    throw Error("Explicit hostless private database environment required");
}
