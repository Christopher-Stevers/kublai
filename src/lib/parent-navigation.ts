/** The parent of a routed screen. Jobs is the app's root. */
export function parentRoute(pathname: string): string {
  const path = pathname.replace(/\/$/, "");
  if (path === "/jobs/account/settings") return "/jobs/account";
  const job = /^\/jobs\/([0-9a-f-]{36})(?:\/(.+))?$/.exec(path);
  if (job) return job[2] ? `/jobs/${job[1]}` : "/jobs";
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent.startsWith("/jobs/") ? parent : "/jobs";
}
