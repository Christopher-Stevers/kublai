// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const entry = path.join(
  root,
  "src/components/materialLists/ReceivingResolve.tsx",
);
function closure(override?: string) {
  const visited = new Set<string>();
  const visit = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    const ast = ts.createSourceFile(
      file,
      file === entry && override ? override : fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    for (const node of ast.statements) {
      if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node))
        continue;
      if (
        ts.isImportDeclaration(node) &&
        (node.importClause?.isTypeOnly ||
          (!node.importClause?.name &&
            node.importClause?.namedBindings &&
            ts.isNamedImports(node.importClause.namedBindings) &&
            node.importClause.namedBindings.elements.every(
              (item) => item.isTypeOnly,
            )))
      )
        continue;
      if (ts.isExportDeclaration(node) && node.isTypeOnly) continue;
      if (!node.moduleSpecifier || !ts.isStringLiteral(node.moduleSpecifier))
        continue;
      const name = node.moduleSpecifier.text;
      const target = name.startsWith("~/")
        ? path.join(root, "src", name.slice(2))
        : name.startsWith(".")
          ? path.resolve(path.dirname(file), name)
          : null;
      if (!target) continue;
      const resolved = [
        target,
        target + ".ts",
        target + ".tsx",
        path.join(target, "index.ts"),
        path.join(target, "index.tsx"),
      ].find((value) => fs.existsSync(value) && fs.statSync(value).isFile());
      if (resolved && /\.[jt]sx?$/.test(resolved)) visit(resolved);
    }
  };
  visit(entry);
  return [...visited].map((file) => path.relative(root, file));
}
it("keeps normal link actions eager without importing resolution editor/upload/source UI", () => {
  const files = closure();
  expect(files).toContain(
    "src/components/materialLists/receiving-link-action.ts",
  );
  for (const name of [
    "ReceivingResolveContent.tsx",
    "ResolveSlipSource.tsx",
    "ReceivingReplaceSource.tsx",
    "ReceivingItemPreview.tsx",
  ])
    expect(files.some((file) => file.endsWith(name))).toBe(false);
});
it("detects a planted static editor edge", () => {
  const files = closure(
    fs.readFileSync(entry, "utf8") +
      '\nimport { ReceivingResolve as Eager } from "./ReceivingResolveContent";\n',
  );
  expect(files).toContain(
    "src/components/materialLists/ReceivingResolveContent.tsx",
  );
});

it("detects a static default import even when named bindings are type-only", () => {
  const files = closure(
    fs.readFileSync(entry, "utf8") +
      '\nimport Eager, { type ResolveTarget } from "./ReceivingResolveContent";\n',
  );
  expect(files).toContain(
    "src/components/materialLists/ReceivingResolveContent.tsx",
  );
});
