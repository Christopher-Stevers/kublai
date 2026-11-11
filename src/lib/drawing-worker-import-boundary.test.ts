import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Source reachability rather than a compressed-byte estimate: type-only imports
// and dynamic engine/worker loads must not become global static dependencies.
function staticSourceClosure(entry: string, override?: Map<string, string>) {
  const seen = new Set<string>();
  function visit(file: string) {
    if (seen.has(file)) return;
    seen.add(file);
    const code = override?.get(file) ?? readFileSync(file, "utf8");
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    for (const node of source.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) continue;
      if (ts.isImportDeclaration(node) && (node.importClause?.isTypeOnly ||
        (!node.importClause?.name && node.importClause?.namedBindings &&
          ts.isNamedImports(node.importClause.namedBindings) && node.importClause.namedBindings.elements.every(item => item.isTypeOnly)))) continue;
      if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
      const specifier = node.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      const name = specifier.text;
      const base = name.startsWith("~/") ? path.resolve("src", name.slice(2)) : name.startsWith(".") ? path.resolve(path.dirname(file), name) : null;
      if (!base) continue;
      const resolved = [base + ".ts", base + ".tsx", base + ".js", path.join(base, "index.ts")].find(existsSync);
      if (resolved) visit(resolved);
    }
  }
  visit(path.resolve(entry));
  return new Set([...seen].map(name => path.relative(process.cwd(), name)));
}

describe("global drawing cleanup import boundary", () => {
  it("global account cleanup no longer reaches pipe computation", () => {
    const closure = staticSourceClosure("src/components/jobs/DrawingAccountProvider.tsx");
    expect(closure.has("src/lib/drawing-worker-lifecycle.ts")).toBe(true);
    expect(closure.has("src/lib/drawing-geometry-client.ts")).toBe(false);
    expect(closure.has("src/lib/pipe-system.ts")).toBe(false);
  });

  it.each(["pdf-client", "drawing-pdf-export-client", "drawing-pdf-raster-client"])("%s does not statically load the geometry engine", name => {
    const closure = staticSourceClosure(`src/lib/${name}.ts`);
    expect(closure.has("src/lib/drawing-worker-lifecycle.ts")).toBe(true);
    for (const file of ["drawing-geometry-client", "pipe-run-sizes", "pipe-system", "drawing-geometry-fallback"])
      expect(closure.has(`src/lib/${file}.ts`)).toBe(false);
  });

  it("detects the original global-cleanup path to pipe computation", () => {
    const entry = path.resolve("src/lib/pdf-client.ts");
    const old = readFileSync(entry, "utf8").replace('from "./drawing-worker-lifecycle"', 'from "./drawing-geometry-client"');
    const closure = staticSourceClosure(entry, new Map([[entry, old]]));
    expect(closure.has("src/lib/drawing-geometry-client.ts")).toBe(true);
    expect(closure.has("src/lib/pipe-system.ts")).toBe(true);
  });
});
