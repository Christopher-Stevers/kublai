import { buildDrawingPdf, buildDrawingPackage } from "./drawing-pdf-build";
import type {
  DrawingExportRequest,
  DrawingExportResponse,
  PreparedDrawingExport,
} from "./drawing-pdf-export-protocol";
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<DrawingExportRequest>) => void) | null;
  postMessage: (
    value: DrawingExportResponse,
    transfer?: Transferable[],
  ) => void;
};
function restore(options: PreparedDrawingExport) {
  const { linkUrls, ...rest } = options;
  const urls = new Map(
    options.markups?.map((markup, index) => [markup, linkUrls[index] ?? null]),
  );
  return {
    ...rest,
    markupLinkUrl: (markup: NonNullable<typeof options.markups>[number]) =>
      urls.get(markup) ?? null,
  };
}
scope.onmessage = ({ data }) => {
  void (async () => {
    try {
      const output =
        data.kind === "sheet"
          ? await buildDrawingPdf(restore(data.options))
          : await buildDrawingPackage({
              ...data.options,
              sheets: data.options.sheets.map(restore),
            });
      const bytes = new Uint8Array(output);
      scope.postMessage({ ok: true, bytes }, [bytes.buffer]);
    } catch (error) {
      scope.postMessage({
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "The drawing PDF could not be prepared.",
      });
    }
  })();
};
