import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root = process.cwd();
const rows = [];
function scan(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { scan(file); continue; }
    if (!/\.tsx$/.test(file) || /(?:test|spec)\.tsx$/.test(file)) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        const names = node.attributes.properties.filter(ts.isJsxAttribute).map(p => p.name.getText(source));
        if (['button', 'Button', 'LargeButton', 'Link'].includes(tag) || names.includes('onClick')) {
          const content = (ts.isJsxOpeningElement(node) ? node.parent : node).getText(source);
          const risky = /\b(?:delete|remove|accept|approve|sendGeneratedOrder|sendOrder|payment|purchase)\b/i.test(content);
          const fixed = /priority-action-bar|Toolbar|Tabs|Dialog/.test(file);
          rows.push({ file: path.relative(root, file), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, tag,
            proposed: risky ? 'release: destructive/money/approval candidate' : fixed ? 'fixed: review before pointer-down' : 'row-or-control: inspect scroll container',
            existingPress: names.includes('press'), prepares: names.some(n => ['onPointerDown','onTouchStart','onMouseEnter'].includes(n)), rawNavigation: names.includes('onClick') && /(?:router\.(?:push|replace)|navigateWorkspace|openJob)\(/.test(content) });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
scan(path.join(root, 'src'));
const report = { generatedAt: new Date().toISOString(), method: 'TypeScript AST inventory with conservative text heuristics; classifications require human/code review, never an automatic conversion', totals: { controls: rows.length, rawButtons: rows.filter(r => r.tag === 'button').length, rawNavigation: rows.filter(r => r.rawNavigation).length }, controls: rows };
const output = process.argv[2];
if (!output) throw new Error('Usage: node perf/press-audit.mjs /path/report.json');
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.totals));
