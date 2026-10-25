import { checkpoint } from "./checkpoint";
import { documentBlobPath } from "../documents/storage";
import { extractionSession } from "./extract-session";
import path from "node:path";
import {
  extractedSourceSchema,
  type AssessmentSource,
  type ExtractedSource,
} from "./types";

// Increment when PDF/OCR settings, text normalization or extraction dependencies change.
export const EXTRACTION_VERSION = 2;
export async function extractSpecification(
  organizationId: string,
  source: AssessmentSource,
  options?: {
    checkpointRoot: string;
    progress: (stage: string) => Promise<void>;
  },
): Promise<ExtractedSource> {
  // Validates tenant/hash and keeps evidence private beside the immutable source.
  const blob = documentBlobPath(organizationId, source.sha256);
  const cacheRoot = path.join(
    path.dirname(blob),
    `${source.sha256}.text-v${EXTRACTION_VERSION}`,
  );
  const session = extractionSession(organizationId, source);
  const result: ExtractedSource = { pages: [], warnings: [] };
  let nextPage = 1;
  try {
    do {
      await options?.progress(
        `Reading ${source.name}: pages ${nextPage}–${result.totalPages ? Math.min(nextPage + 7, result.totalPages) : nextPage + 7}${result.totalPages ? ` of ${result.totalPages}` : ""}`,
      );
      const start = nextPage;
      const work = () =>
        checkpoint(
          cacheRoot,
          {
            version: EXTRACTION_VERSION,
            mime: source.mimeType,
            extension: path
              .extname(source.fileName ?? source.name)
              .toLowerCase(),
            start,
            count: 8,
          },
          (v) => extractedSourceSchema.parse(v),
          () => session.read(start),
          {
            shouldSave: (chunk) =>
              !chunk.warnings.some((warning) =>
                warning.includes("could not be read"),
              ),
          },
        );
      const chunk = options
        ? await checkpoint(
            options.checkpointRoot,
            { version: EXTRACTION_VERSION, type: "extraction", source, start },
            (v) => extractedSourceSchema.parse(v),
            work,
          )
        : await work();
      result.pages.push(...chunk.pages);
      result.warnings.push(...chunk.warnings);
      result.totalPages = chunk.totalPages;
      nextPage += 8;
    } while (
      source.mimeType === "application/pdf" &&
      result.totalPages &&
      nextPage <= result.totalPages
    );
    return result;
  } finally {
    await session.close();
  }
}
