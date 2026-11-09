/** Preserve the material-list parent when opening its packing-slip review. */
export function receivingReviewHref(jobId: string, documentId: string, materialListId?: string) {
  const query = new URLSearchParams({ document: documentId });
  if (materialListId) query.set("fromMaterialList", materialListId);
  return `/jobs/${encodeURIComponent(jobId)}/receiving?${query}`;
}
