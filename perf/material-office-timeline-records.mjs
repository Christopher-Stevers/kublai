// Supplemental only: strict metadata projection, never headers/bodies/URLs.
export function projectApiTrace(lines) {
  return lines
    .filter((e) =>
      ["context-options", "before", "input", "after", "log"].includes(e.type),
    )
    .map((e) => {
      if (e.type === "context-options")
        return {
          type: e.type,
          monotonicTime: e.monotonicTime,
          wallTime: e.wallTime,
        };
      const row = { type: e.type, callId: e.callId };
      if (e.type === "before" && typeof e.params?.expression === "string") {
        const text = e.params.expression;
        row.evaluationKind = text.includes("requestAnimationFrame")
          ? "raf-evaluation"
          : text.includes("__officeTimeline.finish")
            ? "observer-finish"
            : text.includes("office-timeline:action-start")
              ? "action-anchor"
              : "other-evaluation";
      }
      for (const k of [
        "startTime",
        "endTime",
        "time",
        "inputTime",
        "class",
        "method",
        "parentId",
      ])
        if (typeof e[k] === "number" || typeof e[k] === "string") row[k] = e[k];
      if (e.type === "log" && typeof e.message === "string") {
        for (const [kind, pattern] of [
          [
            "actionability",
            /waiting for element to be visible, enabled and stable/,
          ],
          ["stable", /element is visible, enabled and stable/],
          ["scroll", /scrolling into view/],
          ["input", /performing click action/],
          ["navigation", /waiting for scheduled navigations/],
          ["done", /action done/],
        ])
          if (pattern.test(e.message)) {
            row.logKind = kind;
            break;
          }
      }
      // API name/selector/evaluation payloads, log text and results are deliberately omitted.
      return row;
    });
}
export function requestPath(url, base) {
  const u = new URL(url);
  if (u.origin !== new URL(base).origin) return "/external";
  if (
    /^\/api\/trpc\/[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*(,[A-Za-z][A-Za-z0-9_]*\.[A-Za-z][A-Za-z0-9_]*)*$/.test(
      u.pathname,
    )
  )
    return u.pathname;
  if (
    [
      "/api/replicache/catalogue/pull",
      "/api/replicache/catalogue/push",
      "/api/replicache/material-lists/pull",
      "/api/replicache/material-lists/push",
      "/api/perf",
      "/api/debug/client-console-error",
    ].includes(u.pathname)
  )
    return u.pathname;
  return u.pathname.startsWith("/_next/") ? "/static-or-flight" : "/other";
}
export function allowReadRequest(request, base) {
  const u = new URL(request.url());
  if (["data:", "blob:"].includes(u.protocol)) return true;
  if (u.origin !== new URL(base).origin) return false;
  const method = request.method();
  if (["GET", "HEAD"].includes(method)) return true;
  if (method !== "POST") return false;
  if (
    [
      "/api/replicache/catalogue/pull",
      "/api/replicache/material-lists/pull",
      "/api/perf",
      "/api/trpc/appDevices.report",
      "/api/debug/client-console-error",
    ].includes(u.pathname)
  )
    return true;
  if (
    [
      "/api/replicache/catalogue/push",
      "/api/replicache/material-lists/push",
    ].includes(u.pathname)
  ) {
    try {
      const b = request.postDataJSON();
      return Array.isArray(b?.mutations) && b.mutations.length === 0;
    } catch {
      return false;
    }
  }
  return false;
}
export function decodeTraceFiles(text, network) {
  if (network.length !== 0) throw Error("Unexpected HAR/network capture");
  const lines = text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  if (
    !lines.some((e) => e.type === "context-options") ||
    !lines.some((e) => e.type === "before") ||
    !lines.some((e) => e.type === "after")
  )
    throw Error("Incomplete installed API trace");
  return projectApiTrace(lines);
}
