// Local only: use adb reverse for an authorized physical phone. Never bind 0.0.0.0.
import http from "node:http";
import path from "node:path";
import { readFile } from "node:fs/promises";
const root = path.resolve("perf/drawings"),
  corpus = JSON.parse(
    await readFile(path.join(root, "private/corpus.json"), "utf8"),
  );
const files = new Map(corpus.samples.map((s) => [s.hash, s.file]));
const pdfRoot = path.resolve("node_modules/pdfjs-dist");
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      if (req.method !== "GET") throw Error("GET only");
      let file,
        type = "application/javascript";
      if (url.pathname === "/") {
        file = path.join(root, "phone.html");
        type = "text/html";
      } else if (url.pathname === "/manifest") {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            samples: corpus.samples.map(({ hash, pdfBytes }) => ({
              hash,
              pdfBytes,
            })),
          }),
        );
        return;
      } else if (/^\/sheet\/[a-f0-9]{64}$/.test(url.pathname)) {
        file = files.get(url.pathname.slice(7));
        type = "application/pdf";
      } else if (url.pathname === "/pdf.mjs")
        file = path.join(pdfRoot, "legacy/build/pdf.mjs");
      else if (url.pathname === "/pdf.worker.mjs")
        file = path.join(pdfRoot, "legacy/build/pdf.worker.mjs");
      else if (/^\/(?:fonts|cmaps|wasm)\/[a-zA-Z0-9_.-]+$/.test(url.pathname)) {
        const [category, name] = url.pathname.slice(1).split("/");
        file = path.join(
          pdfRoot,
          category === "fonts" ? "standard_fonts" : category,
          name,
        );
        type = name.endsWith(".wasm")
          ? "application/wasm"
          : "application/octet-stream";
      }
      if (!file) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", type);
      res.end(await readFile(file));
    } catch {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(3494, "127.0.0.1", () =>
    console.log("Drawing-only local lab: http://127.0.0.1:3494"),
  );
