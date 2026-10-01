import path from "node:path";

// Node reads these decoder assets from disk. Without this directory PDF.js can
// finish rendering while silently omitting JBIG2 (monochrome scanned) images.
// Resolve from the installed package, including pnpm's real package directory.
export const SERVER_PDF_RENDER_OPTIONS = {
  useSystemFonts: true,
  useWorkerFetch: false,
  wasmUrl:
    path.join(
      path.dirname(
        // Use Node's native resolver at runtime. Webpack transforms imported
        // createRequire(...).resolve calls into numeric bundle module IDs.
        process
          .getBuiltinModule("module")
          .createRequire(path.join(process.cwd(), "package.json"))
          .resolve("pdfjs-dist/package.json"),
      ),
      "wasm",
    ) + path.sep,
};
