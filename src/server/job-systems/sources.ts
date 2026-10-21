import { createHash } from "node:crypto";
import type { JobSystemRequirements } from "~/lib/job-systems";
import { documentActor, type DocumentAccess } from "../documents/access";
import { folderRole } from "../documents/domain";
import type { DocumentState } from "../documents/types";
import type { AssessmentSource } from "./types";
export function specificationSources(
  state: DocumentState,
  access: DocumentAccess,
) {
  const actor = documentActor(access, []);
  const roots = state.folders.filter(
    (f) =>
      f.parentId === null && f.name.trim().toLowerCase() === "specifications",
  );
  const ids = new Set(roots.map((f) => f.id));
  let remainingPasses = state.folders.length;
  while (remainingPasses-- > 0) {
    let added = false;
    for (const f of state.folders)
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        added = true;
      }
    if (!added) break;
  }
  const documents = state.documents.filter(
    (d) =>
      d.jobId === access.job.id &&
      !d.deletedAt &&
      d.folderId &&
      ids.has(d.folderId) &&
      folderRole(state, actor, d.folderId),
  );
  const sources: AssessmentSource[] = [];
  const unsupported: string[] = [];
  for (const doc of documents) {
    const version = state.versions.find(
      (v) => v.id === doc.currentVersionId && v.documentId === doc.id,
    );
    if (!version) {
      unsupported.push(doc.name);
      continue;
    }
    sources.push({
      documentId: doc.id,
      versionId: version.id,
      name: doc.name,
      fileName: version.name,
      sha256: version.sha256,
      mimeType: version.mimeType,
    });
  }
  return {
    folderId: roots.find((f) => folderRole(state, actor, f.id))?.id ?? null,
    sources: sources.sort((a, b) => a.documentId.localeCompare(b.documentId)),
    unsupported,
  };
}
export function sourceFingerprint(sources: readonly AssessmentSource[]) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        sources
          .map((s) => [s.documentId, s.versionId, s.sha256])
          .sort((a, b) => a[0]!.localeCompare(b[0]!)),
      ),
    )
    .digest("hex");
}
/** Do not reveal restricted source passages through another API. Keep a blocking placeholder. */
export function redactSystemRequirements(
  requirements: JobSystemRequirements,
  readableDocumentIds: ReadonlySet<string>,
): JobSystemRequirements {
  const all = [
    ...requirements.applicabilityEvidence,
    ...requirements.rules.flatMap((r) => r.evidence),
  ];
  if (
    [...all, ...requirements.sourceVersions].every((e) =>
      readableDocumentIds.has(e.documentId),
    )
  )
    return requirements;
  return {
    version: 1,
    systemName: "Restricted system specification",
    applicabilityEvidence: [],
    rules: [],
    sourceVersions: [],
    suppressedRuleIds: [],
    manualName: false,
    issues: [
      {
        code: "restricted_sources",
        message:
          "This system references documents you cannot access. Ask a job manager for access before editing or using it.",
        ruleId: null,
        blocking: true,
        resolved: false,
      },
    ],
  };
}
