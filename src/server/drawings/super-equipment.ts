import { TRPCError } from "@trpc/server";
import {
  containsEquipmentTag,
  equipmentDocumentDestination,
  equipmentDrawingDestination,
  equipmentModelKey,
} from "~/lib/equipment-tags";
import {
  equipmentCoverage,
  type EquipmentEvidence,
  type EquipmentReportLine,
} from "~/lib/super-equipment";
import type { DrawingContext } from "./service";
import { makeSnapshotSource } from "~/lib/snapshot-source";
import {
  clearEquipmentRegisters,
  jobFiles,
  readRegisters,
} from "./equipment-register";
import { recognizeEquipmentPage } from "./equipment-index";

type Input = { sheetId: string; documentIds?: string[] };
function selectedDocuments(
  job: Awaited<ReturnType<typeof jobFiles>>,
  ids?: string[],
) {
  const selected = ids ? new Set(ids) : null;
  if (
    selected &&
    [...selected].some((id) => !job.documents.some((d) => d.doc.id === id))
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A selected document is no longer accessible. Refresh the source selection.",
    });
  return job.documents.filter((d) => !selected || selected.has(d.doc.id));
}
function folderPath(
  job: Awaited<ReturnType<typeof jobFiles>>,
  id: string | null,
) {
  const names: string[] = [],
    seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = job.context.docs.folders.find((f) => f.id === id);
    if (!folder) break;
    names.unshift(folder.name);
    id = folder.parentId;
  }
  return names.join(" / ");
}
export async function superEquipmentSources(
  ctx: DrawingContext,
  sheetId: string,
) {
  const job = await jobFiles(ctx, sheetId);
  return {
    documents: job.documents.map(({ doc, version }) => ({
      id: doc.id,
      name: doc.name,
      folder: folderPath(job, doc.folderId),
      version: version?.number ?? null,
      submittal: Boolean(doc.submittal),
    })),
    sheets: job.drawings.length,
  };
}

export async function superEquipmentReport(ctx: DrawingContext, input: Input) {
  const job = await jobFiles(ctx, input.sheetId);
  const documents = selectedDocuments(job, input.documentIds);
  const paths = new Set([
    ...job.drawings.map((d) => d.file),
    ...documents.flatMap((d) => (d.file ? [d.file] : [])),
  ]);
  const files = job.files.filter((f) => paths.has(f.file));
  const { loaded, failed, pending } = await readRegisters(files, 12_000);
  const warnings: string[] = [];
  const ocr: Array<{
    kind: "drawing" | "document";
    id: string;
    page: number;
    name: string;
  }> = [];
  const unreadable: string[] = [];
  let documentsRead = 0,
    documentsComplete = documents.length > 0;
  const docData = documents.map((d) => {
    const register = d.file
      ? loaded.get(`${d.office ? "office" : "pdf"}:${d.file}`)
      : undefined;
    if (register) documentsRead++;
    if (!register || register.incomplete || register.emptyPages.length)
      documentsComplete = false;
    if (
      !d.file ||
      (d.file && failed.has(`${d.office ? "office" : "pdf"}:${d.file}`))
    )
      unreadable.push(d.doc.name);
    if (register && !d.office)
      for (const page of register.emptyPages) {
        if (!register.ocrPages.includes(page))
          ocr.push({ kind: "document", id: d.doc.id, page, name: d.doc.name });
        else unreadable.push(`${d.doc.name} p. ${page} (no text recognized)`);
      }
    const descriptor = [
      d.doc.name,
      d.doc.description,
      ...d.doc.tags,
      d.doc.submittal?.title,
      d.doc.submittal?.manufacturer,
      d.doc.submittal?.specSection,
    ]
      .filter(Boolean)
      .join(" ");
    const isSubmittal =
      Boolean(d.doc.submittal) ||
      /\b(?:submittals?|shop[\s_-]*drawings?)\b/i.test(
        `${d.doc.name} ${folderPath(job, d.doc.folderId)} ${d.doc.tags.join(" ")}`,
      );
    return { ...d, register, descriptor, isSubmittal };
  });
  let sheetsRead = 0,
    ocrSheets = 0;
  const lines: EquipmentReportLine[] = [];
  const evidence = new Map<string, EquipmentEvidence[]>();
  for (const drawing of job.drawings) {
    const register = loaded.get(`pdf:${drawing.file}`);
    if (!register) {
      if (failed.has(`pdf:${drawing.file}`))
        unreadable.push(drawing.sheet.name);
      continue;
    }
    if (!register.textPages.has(drawing.page)) {
      if (!register.ocrPages.includes(drawing.page))
        ocr.push({
          kind: "drawing",
          id: drawing.sheet.id,
          page: drawing.page,
          name: drawing.sheet.name,
        });
      else unreadable.push(`${drawing.sheet.name} (no text recognized)`);
      continue;
    }
    sheetsRead++;
    if (register.ocrPages.includes(drawing.page)) ocrSheets++;
    for (const entry of register.schedules.filter(
      (s) => s.page === drawing.page,
    )) {
      const model = entry.fields?.model
        ? equipmentModelKey(entry.fields.model)
        : null;
      const evidenceKey = `${entry.tag}:${model ?? ""}`;
      let matches = evidence.get(evidenceKey);
      if (!matches) {
        matches = [];
        for (const d of docData) {
          const occurrences = [...(d.register?.pages ?? [])].flatMap(
            ([page, tags]) => {
              const box = tags.get(entry.tag)?.[0];
              return box ? [{ page, box }] : [];
            },
          );
          const metadataMatch = containsEquipmentTag(d.descriptor, entry.tag);
          const tagMatch = metadataMatch || occurrences.length > 0;
          const modelPosition = model
            ? d.register?.models.get(model)
            : undefined;
          const modelMatch = Boolean(
            model &&
            (Boolean(modelPosition) ||
              d.descriptor
                .split(/\s+/)
                .some((text) => equipmentModelKey(text) === model)),
          );
          if (!tagMatch && !modelMatch) continue;
          const first = occurrences[0] ?? modelPosition;
          const changesRequested = job.context.docs.reviews.some(
            (r) =>
              r.status === "changes_requested" &&
              r.documents.some(
                (snapshot) =>
                  snapshot.documentId === d.doc.id &&
                  snapshot.versionId === d.version?.id,
              ),
          );
          const confirmed =
            tagMatch &&
            d.isSubmittal &&
            Boolean(d.version) &&
            d.doc.status !== "superseded" &&
            !changesRequested;
          matches.push({
            documentId: d.doc.id,
            name: d.doc.name,
            version: d.version?.number ?? null,
            status: changesRequested
              ? "Changes requested"
              : d.doc.status.replaceAll("_", " "),
            pages: d.office
              ? []
              : occurrences.length
                ? occurrences.map((p) => p.page)
                : modelPosition
                  ? [modelPosition.page]
                  : [],
            confirmed,
            reason: `${tagMatch ? `Exact equipment tag ${metadataMatch ? "in document details" : d.office ? "in document text" : `on page ${first!.page}`}.` : `Model ${entry.fields!.model} matches, but no equipment tag was found. Verify that this document covers this schedule line.`} ${d.isSubmittal ? "Identified as a shop drawing/submittal." : "Document is not identified as a submittal; review its contents."}${d.doc.status === "superseded" || changesRequested ? " A current acceptable replacement needs review." : ""}`,
            url:
              first && d.version && !d.office
                ? equipmentDocumentDestination({
                    jobId: job.jobId,
                    documentId: d.doc.id,
                    versionId: d.version.id,
                    name: d.doc.name,
                    tag: entry.tag,
                    page: first.page,
                    box: first.box,
                  }).href
                : makeSnapshotSource(
                    `/jobs/${job.jobId}/documents`,
                    {
                      version: 1,
                      document: {
                        jobId: job.jobId,
                        documentId: d.doc.id,
                        versionId: d.version?.id ?? null,
                        tab: "details",
                        viewer: "preview",
                      },
                    },
                    d.doc.name,
                  ).href,
          });
        }
        matches.sort(
          (a, b) =>
            Number(b.confirmed) - Number(a.confirmed) ||
            a.name.localeCompare(b.name),
        );
        evidence.set(evidenceKey, matches);
      }
      lines.push({
        id: `${drawing.sheet.id}:${entry.tag}:${entry.box.left.toFixed(3)}:${entry.box.top.toFixed(3)}`,
        tag: entry.tag,
        schedule: entry.title || "Equipment schedule",
        cells: entry.cells,
        sheetId: drawing.sheet.id,
        sheet: drawing.sheet.name,
        set: drawing.sheet.setName ?? "",
        page: entry.page,
        status: equipmentCoverage(matches, documentsComplete),
        matches,
        sourceUrl: equipmentDrawingDestination({
          jobId: job.jobId,
          setId: drawing.sheet.setId,
          sheetId: drawing.sheet.id,
          sourceSheetId: drawing.current.id,
          name: drawing.sheet.name,
          tag: entry.tag,
          box: entry.box,
        }).href,
      });
    }
  }
  if (pending)
    warnings.push(
      `${pending} files are still being indexed. Results will update as they finish.`,
    );
  if (ocr.length)
    warnings.push(
      `${ocr.length} pages have no embedded text. Recognize scanned pages to search them.`,
    );
  if (unreadable.length)
    warnings.push(
      `Not fully searched: ${[...new Set(unreadable)].slice(0, 20).join(", ")}${unreadable.length > 20 ? ` and ${unreadable.length - 20} more` : ""}.`,
    );
  if ([...loaded.values()].some((r) => r.incomplete))
    warnings.push(
      "Some files exceeded the reading limit. Review the remaining pages manually.",
    );
  if (ocrSheets || [...loaded.values()].some((r) => r.ocrPages.length))
    warnings.push(
      "Text recognition was used. Verify equipment tags and schedule rows against the source images.",
    );
  if (!documents.length)
    warnings.push(
      "No accessible documents selected. Add shop drawings under Documents or change the source selection.",
    );
  const unsupportedSheets = job.logicalSheets.length - job.drawings.length;
  if (unsupportedSheets)
    warnings.push(
      `${unsupportedSheets} drawings do not have a searchable original PDF.`,
    );
  const truncated = lines.length > 5000;
  if (truncated)
    warnings.push(
      "Showing the first 5,000 schedule lines. Remaining lines require manual review.",
    );
  return {
    lines: lines.slice(0, 5000),
    generatedAt: new Date().toISOString(),
    warnings,
    pending,
    ocr,
    coverage: {
      sheets: sheetsRead,
      totalSheets: job.logicalSheets.length,
      documents: documentsRead,
      totalDocuments: documents.length,
    },
  };
}

/** The caller sends an accessible source ID, never a server path. Resolve it
 * again so deleted/replaced/private files cannot be OCR'd through an old report. */
export async function recognizeEquipmentSource(
  ctx: DrawingContext,
  input: {
    sheetId: string;
    kind: "drawing" | "document";
    id: string;
    page: number;
  },
) {
  const job = await jobFiles(ctx, input.sheetId);
  const drawing = job.drawings.find(
    (d) => d.sheet.id === input.id && d.page === input.page,
  );
  const document = job.documents.find(
    (d) => d.doc.id === input.id && !d.office,
  );
  const file = input.kind === "drawing" ? drawing?.file : document?.file;
  if (!file)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "This source is no longer accessible as a PDF. Refresh the report.",
    });
  await recognizeEquipmentPage(file, input.page);
  clearEquipmentRegisters();
  return { ok: true };
}
