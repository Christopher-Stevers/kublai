import { inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { drawingWorkspaceMetadata } from "~/server/db/drawing-workspace-schema";
import { documentBlobPath } from "~/server/documents/storage";
import type { TitleBlockWord } from "~/lib/drawing-title-block";
import {
  containsEquipmentTag,
  drawingSheetNumbers,
  equipmentDocumentDestination,
  equipmentDrawingDestination,
  equipmentSchedules,
  equipmentTagIndex,
  normalizeEquipmentTag,
  sheetNumberOfName,
  tagPattern,
  type EquipmentScheduleEntry,
} from "~/lib/equipment-tags";
import { drawingPdfLocation, equipmentIndex } from "./equipment-index";
import { searchContext } from "./equipment-links";
import type { DrawingContext } from "./service";

/**
 * A job's equipment register: every tag in every current drawing and
 * document, with the schedules that define them. Uploaded files are
 * immutable, so each file is read once and kept as a compact tag index.
 */
type FileRegister = {
  pages: Map<number, Map<string, TitleBlockWord[]>>;
  schedules: EquipmentScheduleEntry[];
  sheetNumbers: string[];
  textPages: Set<number>;
};
const registers = new Map<string, FileRegister>();
const building = new Map<string, Promise<FileRegister>>();
const MAX_REGISTERS = 96;
async function fileRegister(file: string, format: "pdf" | "office") {
  const key = `${format}:${file}`;
  const saved = registers.get(key);
  if (saved) {
    registers.delete(key);
    registers.set(key, saved);
    return saved;
  }
  let pending = building.get(key);
  if (!pending) {
    pending = equipmentIndex(file, format)
      .then((index) => {
        const sheetNumbers = format === "pdf" ? drawingSheetNumbers(index.pages) : [];
        const register: FileRegister = {
          pages: new Map(index.pages.map((page) => [page.page, equipmentTagIndex(page.words)])),
          // Office text has no page coordinates, so its tables cannot be read as schedules.
          schedules: format === "pdf" ? equipmentSchedules(index.pages, { sheetNumbers }) : [],
          sheetNumbers,
          textPages: new Set(index.pages.filter((page) => page.words.length).map((page) => page.page)),
        };
        registers.set(key, register);
        while (registers.size > MAX_REGISTERS) registers.delete(registers.keys().next().value!);
        return register;
      })
      .finally(() => building.delete(key));
    building.set(key, pending);
  }
  return pending;
}

/** Tests only: files are otherwise immutable, so registers never go stale. */
export function clearEquipmentRegisters() {
  registers.clear();
}

type File = { key: string; file: string; format: "pdf" | "office" };
/** Current sheets of every set and every current document, grouped by the file holding their text. */
async function jobFiles(ctx: DrawingContext, sheetId: string) {
  const context = await searchContext(ctx, sheetId);
  const { jobId, organizationId } = context.access.sheet;
  const sheets = context.sheets.filter((sheet) => !context.historical.has(sheet.id));
  const metadata = sheets.length
    ? await ctx.db
        .select({ sheetId: drawingWorkspaceMetadata.sheetId, data: drawingWorkspaceMetadata.data })
        .from(drawingWorkspaceMetadata)
        .where(inArray(drawingWorkspaceMetadata.sheetId, sheets.map((sheet) => sheet.id)))
    : [];
  const currentOf = new Map(metadata.map((row) => [row.sheetId, row.data.currentSourceSheetId]));
  const drawings = sheets.flatMap((sheet) => {
    const current = context.sheets.find((s) => s.id === currentOf.get(sheet.id)) ?? sheet;
    const location = drawingPdfLocation(current.imageUrl, jobId);
    return location ? [{ sheet, current, file: location.file, page: location.page }] : [];
  });
  const documents = context.docs.documents
    .filter((doc) => !doc.deletedAt)
    .map((doc) => {
      const version = context.docs.versions.find((v) => v.id === doc.currentVersionId);
      const office = Boolean(version && /\.(?:docx|xlsx|pptx)$/i.test(version.name));
      const searchable = version && (version.mimeType === "application/pdf" || office);
      return {
        doc,
        version,
        office,
        file: searchable ? documentBlobPath(organizationId, version.sha256) : null,
      };
    });
  const files = new Map<string, File>();
  for (const drawing of drawings) files.set(`pdf:${drawing.file}`, { key: `pdf:${drawing.file}`, file: drawing.file, format: "pdf" });
  for (const document of documents)
    if (document.file) {
      const format = document.office ? "office" : "pdf";
      files.set(`${format}:${document.file}`, { key: `${format}:${document.file}`, file: document.file, format });
    }
  // The sheet being viewed first, then everything else.
  const own = drawings.find((d) => d.sheet.id === sheetId);
  const ordered = [...files.values()].sort((a, b) => Number(b.file === own?.file) - Number(a.file === own?.file));
  return { context, jobId, drawings, documents, files: ordered };
}

/** Read files until the budget runs out; files still indexing are reported, and finish in the background. */
async function readRegisters(files: File[], budgetMs: number) {
  const deadline = Date.now() + budgetMs;
  const loaded = new Map<string, FileRegister>();
  const failed = new Set<string>();
  let pending = 0;
  const queue = [...files];
  const worker = async () => {
    for (let file = queue.shift(); file; file = queue.shift()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        pending++;
        // Keep building it for the next request.
        void fileRegister(file.file, file.format).catch(() => undefined);
        continue;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        fileRegister(file.file, file.format).then(
          (register) => ({ register }),
          () => ({ register: null }),
        ),
        new Promise<"late">((resolve) => (timer = setTimeout(() => resolve("late"), remaining))),
      ]);
      clearTimeout(timer);
      if (result === "late") pending++;
      else if (result.register) loaded.set(file.key, result.register);
      else failed.add(file.key);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { loaded, failed, pending };
}

/** Sheet numbers and scheduled tags across the whole job, for the automatic scan. */
export async function jobEquipmentVocabulary(ctx: DrawingContext, sheetId: string) {
  const job = await jobFiles(ctx, sheetId);
  const { loaded, failed, pending } = await readRegisters(job.files, 15_000);
  const sheetNumbers = new Set<string>();
  for (const drawing of job.drawings) {
    const code = sheetNumberOfName(drawing.sheet.name);
    if (code) sheetNumbers.add(code);
  }
  for (const register of loaded.values()) for (const code of register.sheetNumbers) sheetNumbers.add(code);
  const knownTags = new Set<string>();
  for (const register of loaded.values())
    for (const entry of register.schedules) if (!sheetNumbers.has(entry.tag)) knownTags.add(entry.tag);
  return { knownTags: [...knownTags], sheetNumbers: [...sheetNumbers], pending, failed: failed.size };
}

export type EquipmentTagLink = { label: string; url: string };
export type EquipmentTagResult = {
  tag: string;
  schedules: Array<{ title: string; cells: string[]; source: string; url: string }>;
  drawings: Array<{
    sheetId: string;
    setName: string;
    name: string;
    /** The sheet being viewed: other occurrences on it. */
    here: boolean;
    links: EquipmentTagLink[];
  }>;
  documents: Array<{ documentId: string; name: string; pages: number[]; url: string }>;
  warnings: string[];
  /** Files still being read; asking again will include them. */
  pending: number;
};
const MAX_PER_SHEET = 20;

/** Every current place a tag appears in the job, grouped for choosing a destination. */
export async function equipmentTagDestinations(
  ctx: DrawingContext,
  input: { sheetId: string; tag: string; exclude?: { left: number; top: number; right: number; bottom: number } },
): Promise<EquipmentTagResult> {
  if (!tagPattern(input.tag))
    throw new TRPCError({ code: "BAD_REQUEST", message: "Enter an equipment tag such as HEX-2 or FCU-1." });
  const tag = normalizeEquipmentTag(input.tag);
  const job = await jobFiles(ctx, input.sheetId);
  const { loaded, failed, pending } = await readRegisters(job.files, 20_000);
  const { jobId } = job;
  const result: EquipmentTagResult = { tag, schedules: [], drawings: [], documents: [], warnings: [], pending };
  const excluded = (sheetId: string, box: TitleBlockWord) => {
    const area = input.exclude;
    if (!area || sheetId !== input.sheetId) return false;
    const x = (box.left + box.right) / 2,
      y = (box.top + box.bottom) / 2;
    return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
  };
  const drawingUrl = (drawing: (typeof job.drawings)[number], box: TitleBlockWord) =>
    equipmentDrawingDestination({
      jobId,
      setId: drawing.sheet.setId,
      sheetId: drawing.sheet.id,
      sourceSheetId: drawing.current.id,
      name: drawing.sheet.name,
      tag,
      box,
    }).href;

  for (const drawing of job.drawings) {
    const register = loaded.get(`pdf:${drawing.file}`);
    if (!register) continue;
    for (const entry of register.schedules)
      if (entry.tag === tag && entry.page === drawing.page)
        result.schedules.push({ title: entry.title, cells: entry.cells, source: drawing.sheet.name, url: drawingUrl(drawing, entry.box) });
    const boxes = (register.pages.get(drawing.page)?.get(tag) ?? []).filter((box) => !excluded(drawing.sheet.id, box));
    if (!boxes.length) continue;
    result.drawings.push({
      sheetId: drawing.sheet.id,
      setName: drawing.sheet.setName ?? "",
      name: drawing.sheet.name,
      here: drawing.sheet.id === input.sheetId,
      links: boxes.slice(0, MAX_PER_SHEET).map((box, n) => ({
        label: `${tag} — ${drawing.sheet.name}${boxes.length > 1 ? ` (${n + 1})` : ""}`.slice(0, 255),
        url: drawingUrl(drawing, box),
      })),
    });
  }
  for (const { doc, version, office, file } of job.documents) {
    const register = file ? loaded.get(`${office ? "office" : "pdf"}:${file}`) : undefined;
    const pages: Array<{ page: number; box: TitleBlockWord }> = [];
    for (const [page, tags] of register?.pages ?? []) {
      const box = tags.get(tag)?.[0];
      if (box) pages.push({ page, box });
    }
    const metadata = containsEquipmentTag(
      [doc.name, doc.description, ...doc.tags, doc.submittal?.title, doc.submittal?.manufacturer, doc.submittal?.specSection]
        .filter(Boolean)
        .join(" "),
      tag,
    );
    if (!pages.length && !metadata) continue;
    const first = pages[0];
    if (register && version && !office)
      for (const entry of register.schedules)
        if (entry.tag === tag)
          result.schedules.push({
            title: entry.title,
            cells: entry.cells,
            source: `${doc.name} p. ${entry.page}`,
            url: equipmentDocumentDestination({ jobId, documentId: doc.id, versionId: version.id, name: doc.name, tag, page: entry.page, box: entry.box }).href,
          });
    result.documents.push({
      documentId: doc.id,
      name: doc.name,
      pages: pages.map((p) => p.page).slice(0, 50),
      url:
        first && version && !office
          ? equipmentDocumentDestination({ jobId, documentId: doc.id, versionId: version.id, name: doc.name, tag, page: first.page, box: first.box }).href
          : `/dashboard/jobs/${jobId}/documents?document=${doc.id}`,
    });
  }
  // The sheet being viewed first, then sets and sheets in drawing order.
  result.drawings.sort((a, b) => Number(b.here) - Number(a.here));
  if (failed.size) result.warnings.push(`${failed.size} file${failed.size === 1 ? "" : "s"} could not be searched.`);
  const unreadable = job.drawings.filter((d) => loaded.get(`pdf:${d.file}`) && !loaded.get(`pdf:${d.file}`)!.textPages.has(d.page)).length;
  if (unreadable)
    result.warnings.push(`${unreadable} sheet${unreadable === 1 ? " has" : "s have"} no embedded text and could not be searched.`);
  return result;
}
