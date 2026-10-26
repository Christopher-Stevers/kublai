// Local-only, production React fixture. Pass --ref=<commit> to compare the same
// workload against repository source at that commit, without changing checkout.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
const require = createRequire(import.meta.url);
const esbuild = createRequire(require.resolve("tsx"))("esbuild");
const name = process.argv[2] ?? "current";
if (!/^[a-z-]+$/.test(name)) throw new Error("Use a letter/hyphen build name");
const ref = process.argv.find((arg) => arg.startsWith("--ref="))?.slice(6);
if (ref) execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
await esbuild.build({
  entryPoints: ["scripts/fixtures/drawing-performance/app.tsx"],
  bundle: true,
  outfile: `.tmp/drawing-performance/${name}.js`,
  format: "esm",
  jsx: "automatic",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  alias: { "react-dom/client": "react-dom/profiling" },
  plugins: ref
    ? [
        {
          name: "baseline",
          setup(build) {
            build.onLoad({ filter: /\.[jt]sx?$/ }, (args) => {
              const relative = path.relative(process.cwd(), args.path);
              if (!relative.startsWith("src/")) return;
              return {
                contents: execFileSync("git", ["show", `${ref}:${relative}`], {
                  encoding: "utf8",
                }),
                loader: relative.endsWith("tsx") ? "tsx" : "ts",
              };
            });
          },
        },
      ]
    : [],
});
if (process.argv.includes("--build-only")) process.exit(0);
http
  .createServer((req, res) => {
    const u = new URL(req.url, "http://localhost"),
      version = u.searchParams.get("version") ?? name;
    if (u.pathname.endsWith(".js")) {
      if (
        !/^\/[a-z-]+\.js$/.test(u.pathname) ||
        !fs.existsSync(`.tmp/drawing-performance${u.pathname}`)
      ) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.setHeader("Content-Type", "application/javascript");
      res.setHeader("Cache-Control", "no-store");
      res.end(fs.readFileSync(`.tmp/drawing-performance${u.pathname}`));
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Drawing performance</title><style>
body{margin:0;font-family:system-ui;background:#eee;color:#111}header{padding:8px}button{margin:5px;padding:8px}pre{white-space:pre-wrap;min-height:40px}#frame{position:relative;overflow:hidden;background:white}.absolute{position:absolute}.inset-0{inset:0}.h-full{height:100%}.w-full{width:100%}.overflow-hidden{overflow:hidden}.overflow-visible{overflow:visible}.pointer-events-none{pointer-events:none}
</style><div id="root"></div><script type="module" src="/${/^[a-z-]+$/.test(version) ? version : name}.js"></script>`);
  })
  .listen(3206, "127.0.0.1", () => console.log("http://127.0.0.1:3206"));
