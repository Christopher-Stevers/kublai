/** Route fallback stays inside the page; startup branding belongs to the root. */
export function RouteLoading() {
  return (
    <div data-route-loading role="status" className="px-4 py-6 text-sm text-muted-foreground">
      Loading…
    </div>
  );
}
