/** Server-controlled availability; never inferred from browser storage or request headers. */
export function devFeaturesEnabled() {
  // Explicit production deployments cannot opt in, even with a copied dev flag.
  if (process.env.DEPLOY_ENVIRONMENT === "production") return false;
  const flag = process.env.FOREMANHQ_DEV_FEATURES;
  if (flag !== undefined) return flag === "true";
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

export function devFeatureUnavailable() {
  return Response.json(
    { error: "Not found" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
