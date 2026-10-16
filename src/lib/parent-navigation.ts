/** The parent of a routed screen. Jobs is the app's root. */
export function parentRoute(pathname: string): string {
  const path = pathname.replace(/\/$/, "");
  if (path === "/dashboard/account/settings") return "/dashboard/account";
  const job = /^\/dashboard\/jobs\/([^/]+)(?:\/(.+))?$/.exec(path);
  if (job) return job[2] ? `/dashboard/jobs/${job[1]}` : "/dashboard";
  const parent = path.slice(0, path.lastIndexOf("/"));
  return parent.startsWith("/dashboard/") ? parent : "/dashboard";
}
