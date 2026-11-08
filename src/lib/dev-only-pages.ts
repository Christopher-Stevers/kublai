/** Standalone pages withheld from production; Orders intentionally remains available. */
export const DEV_ONLY_PAGES = ["draws", "estimating", "timesheets", "assets"] as const;

export function isDevOnlyPage(href: string) {
  const pathname = href.split(/[?#]/, 1)[0] ?? "";
  return DEV_ONLY_PAGES.some((page) =>
    pathname === `/jobs/${page}` || pathname.startsWith(`/jobs/${page}/`),
  );
}
