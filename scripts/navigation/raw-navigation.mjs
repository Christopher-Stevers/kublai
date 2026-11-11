import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const VERSION = 'raw-navigation-v1';
const primitives = new Map([
  ['~/components/ui/button', new Set(['Button'])],
  ['~/components/ui/pressable-card', new Set(['PressableCard'])],
  ['next/link', new Set(['default'])],
]);
// A semantic inventory cannot infer arbitrary callback names. These are the
// established navigation APIs/state conventions covered by this narrow rule.
const navigationName = /^(?:navigate(?:Workspace|To)?|openJob|openMaterialList|openSheet|goTo(?:Job|Screen|Page|Tab)|set(?:Active|Selected|Current)?(?:Screen|View|Tab|Job|JobId|MaterialList|MaterialListId))$/;
const routerName = /(?:^router$|Router$|^navigation$|^workspace$)/;
const locationName = /^(?:window\.|document\.|globalThis\.)?location$/;
const hash = text => createHash('sha256').update(text).digest('hex');
/** Token hashing ignores comments/whitespace/line shifts, but retains literal
 * spelling, operators, order, and every handler/local dependency implementation. */
function tokens(text) {
  const scan = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.JSX, text);
  const out = [];
  for (let kind = scan.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scan.scan())
    out.push([kind, scan.getTokenText()]);
  return JSON.stringify(out);
}
function inside(node, ancestor) {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
}
function primitiveSource(value, source) {
  if (!value.startsWith('.')) return value;
  return '~/' + path.posix.normalize(path.posix.join(path.posix.dirname(source.fileName), value)).replace(/^src\//, '').replace(/\.(?:tsx?|jsx?)$/, '');
}
function importedPrimitive(tag, checker) {
  if (!ts.isIdentifier(tag)) return false;
  const declaration = checker.getSymbolAtLocation(tag)?.declarations?.[0];
  if (!declaration) return false;
  if (ts.isImportSpecifier(declaration)) {
    const source = declaration.parent.parent.parent.moduleSpecifier;
    return ts.isStringLiteral(source) && primitives.get(primitiveSource(source.text, tag.getSourceFile()))?.has((declaration.propertyName ?? declaration.name).text);
  }
  if (ts.isImportClause(declaration)) {
    const source = declaration.parent.moduleSpecifier;
    return ts.isStringLiteral(source) && primitives.get(primitiveSource(source.text, tag.getSourceFile()))?.has('default');
  }
  return false;
}
function dependencies(expression, source, checker) {
  const nodes = new Set([expression]);
  const seen = new Set();
  const visit = node => {
    if (seen.has(node)) return;
    seen.add(node);
    // Handler closure changes invalidate the baseline too. Never pull the
    // enclosing component into a row: that would become a blanket file hash.
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      for (let declaration of checker.getSymbolAtLocation(node)?.declarations ?? []) {
        if (ts.isBindingElement(declaration)) {
          while (declaration.parent && !ts.isVariableDeclaration(declaration)) declaration = declaration.parent;
        }
        if (declaration.getSourceFile() !== source || inside(expression, declaration)) continue;
        if (ts.isFunctionDeclaration(declaration) || ts.isVariableDeclaration(declaration)) {
          nodes.add(declaration); visit(declaration);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return [...nodes];
}
function navigationOperations(nodes, source, checker) {
  const routerReceiver = expression => {
    if (routerName.test(expression.getText(source))) return true;
    if (!ts.isIdentifier(expression)) return false;
    return (checker.getSymbolAtLocation(expression)?.declarations ?? []).some(d => ts.isVariableDeclaration(d) && d.initializer && ts.isCallExpression(d.initializer) && /^(?:useRouter|useJobWorkspaceNavigation)$/.test(d.initializer.expression.getText(source)));
  };
  const found = new Set();
  const visit = node => {
    if (ts.isPropertyAccessExpression(node) && routerReceiver(node.expression) && /^(push|replace|back|forward|navigate)$/.test(node.name.text)) found.add(node.getText(source));
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && navigationName.test(callee.text)) found.add(callee.text);
      if (ts.isPropertyAccessExpression(callee)) {
        const owner = callee.expression.getText(source), method = callee.name.text;
        if ((routerReceiver(callee.expression) && /^(push|replace|back|forward|navigate)$/.test(method)) ||
            (locationName.test(owner) && /^(assign|replace|reload)$/.test(method)) ||
            (/^(?:window|globalThis)$/.test(owner) && method === 'open') ||
            (owner === 'history' || owner === 'window.history') && /^(pushState|replaceState|back|forward|go)$/.test(method)) found.add(`${owner}.${method}`);
      }
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const left = node.left.getText(source);
      if (/^(?:(?:window|document|globalThis)\.)?location(?:\.href)?$/.test(left)) found.add(left + '=');
    }
    ts.forEachChild(node, visit);
  };
  nodes.forEach(visit);
  return [...found].sort();
}
export function inspectSources(sources) {
  const names = [...sources.keys()];
  const options = { target: ts.ScriptTarget.Latest, jsx: ts.JsxEmit.Preserve, noResolve: true, noLib: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = file => sources.has(file) ? ts.createSourceFile(file, sources.get(file), ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS) : undefined;
  host.fileExists = file => sources.has(file);
  host.readFile = file => sources.get(file);
  const program = ts.createProgram(names, options, host), checker = program.getTypeChecker();
  const rows = [];
  for (const source of program.getSourceFiles()) {
    if (!source.fileName.endsWith('.tsx') || /(?:test|spec)\.tsx$/.test(source.fileName)) continue;
    if (source.parseDiagnostics.length) throw Error(`Cannot audit malformed TSX: ${source.fileName}`);
    const visit = node => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && !importedPrimitive(node.tagName, checker)) {
        const handler = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'onClick');
        if (handler?.initializer && ts.isJsxExpression(handler.initializer) && handler.initializer.expression) {
          const nodes = dependencies(handler.initializer.expression, source, checker);
          const operations = navigationOperations(nodes, source, checker);
          if (operations.length) {
            const tag = node.tagName.getText(source);
            const normalized = nodes.map(n => tokens(n.getText(source))).sort();
            rows.push({ file: source.fileName.replaceAll('\\', '/'), tag, digest: hash(JSON.stringify({ version: VERSION, tag, nodes: normalized })),
              line: source.getLineAndCharacterOfPosition(handler.getStart(source)).line + 1, operations });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return rows.sort((a,b) => a.file.localeCompare(b.file) || a.line - b.line);
}
export async function collectSources(root) {
  const sources = new Map();
  async function walk(dir) {
    for (const item of await readdir(path.join(root,dir), {withFileTypes:true})) {
      const file = path.posix.join(dir,item.name);
      if (item.isDirectory()) await walk(file);
      else if (/\.tsx?$/.test(file) && !/\.d\.ts$/.test(file)) sources.set(file,await readFile(path.join(root,file),'utf8'));
    }
  }
  await walk('src'); return sources;
}
const key = row => JSON.stringify([row.file,row.tag,row.digest]);
export function checkRows(rows, baseline) {
  if (baseline.version !== VERSION || !Array.isArray(baseline.entries)) throw Error('Unsupported navigation baseline');
  const counts = new Map();
  for (const entry of baseline.entries) {
    if (!entry.reason?.trim() || !['preexisting','keyboard','destructive','manual'].includes(entry.category) || !Number.isSafeInteger(entry.count) || entry.count < 1 || !/^[a-f0-9]{64}$/.test(entry.digest)) throw Error('Invalid exact navigation baseline entry');
    const id = key(entry); if (counts.has(id)) throw Error('Duplicate navigation baseline entry'); counts.set(id,entry.count);
  }
  const violations = [];
  for (const row of rows) {
    const id=key(row), remaining=counts.get(id) ?? 0;
    if (remaining) counts.set(id,remaining-1); else violations.push(row);
  }
  return {violations, accepted:rows.length-violations.length};
}
export function inventory(rows) {
  const entries = new Map();
  for (const row of rows) {
    const id=key(row), prior=entries.get(id);
    if (prior) {prior.count++; prior.lines.push(row.line);}
    else entries.set(id,{...row,count:1,lines:[row.line],category:'preexisting',reason:'Existing raw navigation debt at initial speed-law inventory; migrate through a reviewed press/navigation primitive.'});
  }
  return {version:VERSION,entries:[...entries.values()]};
}
