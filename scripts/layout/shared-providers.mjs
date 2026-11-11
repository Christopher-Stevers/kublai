import ts from 'typescript';
import path from 'node:path';
export const VERSION='shared-layout-providers-v1';
const providerName=name=>/(?:Provider(?:Wrapper)?|Providers)$/.test(name);
function moduleIdentity(owner,module,sources){
 let base=module.startsWith('~/')?'src/'+module.slice(2):module.startsWith('.')?path.posix.normalize(path.posix.join(path.posix.dirname(owner),module)):module;
 if(base.startsWith('src/')) {
  for(const candidate of [base,base+'.tsx',base+'.ts',base+'/index.tsx',base+'/index.ts']) if(sources.has(candidate))return candidate;
 }
 return base;
}
export function inspectProviders(sources){
 const parsed=new Map([...sources].map(([file,text])=>[file,ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS)]));
 const rows=[];
 for(const layout of [...sources.keys()].filter(f=>/^src\/app\/(?:.*\/)?layout\.tsx?$/.test(f)).sort()){
  const visited=new Set();
  function scan(owner){
   if(visited.has(owner))return;visited.add(owner);const source=parsed.get(owner);if(!source)return;
   if(source.parseDiagnostics.length)throw Error('Cannot audit malformed shared layout/wrapper: '+owner);
   const imports=new Map(),aliases=new Map(),contexts=new Set();
   const emit=(kind,module,exportName,node)=>rows.push({layout,owner,kind,module:module.replace(/(?:\/index)?\.tsx?$/, ''),export:exportName,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1});
   for(const node of source.statements){
    if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)&&node.importClause&&!node.importClause.isTypeOnly){
     const module=moduleIdentity(owner,node.moduleSpecifier.text,sources),clause=node.importClause;
     if(clause.name)imports.set(clause.name.text,{module,export:'default',provider:providerName(clause.name.text)||providerName(path.posix.basename(module).replace(/\.[^.]+$/,''))});
     if(clause.namedBindings&&ts.isNamespaceImport(clause.namedBindings))imports.set(clause.namedBindings.name.text,{module,export:'*',provider:false});
     if(clause.namedBindings&&ts.isNamedImports(clause.namedBindings))for(const item of clause.namedBindings.elements)if(!item.isTypeOnly){const original=(item.propertyName??item.name).text;imports.set(item.name.text,{module,export:original,provider:providerName(original)});}
    }
   }
   function declarations(node){
    if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer){
     if(ts.isIdentifier(node.initializer)||ts.isPropertyAccessExpression(node.initializer))aliases.set(node.name.text,node.initializer.getText(source));
     if(ts.isCallExpression(node.initializer)&&/(?:^|\.)createContext$/.test(node.initializer.expression.getText(source)))contexts.add(node.name.text);
    }
    ts.forEachChild(node,declarations);
   }declarations(source);
   function resolve(name,seen=new Set()){
    if(seen.has(name))return null;seen.add(name);
    if(aliases.has(name))return resolve(aliases.get(name),seen);
    if(imports.has(name))return imports.get(name);
    if(name.includes('.')){const [namespace,...parts]=name.split('.');const entry=imports.get(namespace);if(entry?.export==='*')return {module:entry.module,export:parts.join('.'),provider:providerName(parts.at(-1))||parts.at(-1)==='Provider'};}
    if(name.endsWith('.Provider')){const context=name.slice(0,-9);const entry=imports.get(context);return {module:entry?.module??owner,export:(entry?.export??context)+'.Provider',provider:true};}
    if(contexts.has(name))return {module:owner,export:name,provider:true};
    if(providerName(name))return {module:owner,export:name,provider:true};
    return {module:owner,export:name,provider:false};
   }
   // Imports and mounts are separate exact counts: an unused new provider import
   // cannot quietly enter the common bundle and wait for a later mount.
   for(const [local,entry] of imports)if(entry.provider){const declaration=source.statements.find(n=>ts.isImportDeclaration(n)&&n.importClause&&n.getText(source).includes(local));emit('import',entry.module,entry.export,declaration??source);}
   function visit(node){
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)){
     const name=node.tagName.getText(source),entry=resolve(name);
     if(entry?.provider)emit('usage',entry.module,entry.export,node);
     else if(entry&&parsed.has(entry.module)&&entry.module!==owner){
      // Follow only common wrappers carrying the layout's children, not feature
      // leaves such as Header which may own unrelated screen-local contexts.
      const element=ts.isJsxOpeningElement(node)?node.parent:node;
      if(/\bchildren\b/.test(element.getText(source)))scan(entry.module);
     }
    }
    if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)&&node.exportClause&&ts.isNamedExports(node.exportClause))for(const item of node.exportClause.elements)if(item.name.text==='default')scan(moduleIdentity(owner,node.moduleSpecifier.text,sources));
    ts.forEachChild(node,visit);
   }visit(source);
  }scan(layout);
 }
 return rows;
}
const key=row=>JSON.stringify([row.layout,row.owner,row.kind,row.module,row.export]);
export function providerInventory(rows){
 const entries=new Map();for(const row of rows){const id=key(row),prior=entries.get(id);if(prior){prior.count++;prior.lines.push(row.line);}else entries.set(id,{...row,count:1,lines:[row.line],reason:`Existing ${row.kind} of ${row.export} at this exact shared boundary; no additional provider mount/import is authorized.`});}
 return {version:VERSION,entries:[...entries.values()],retired:[]};
}
export function checkProviders(rows,baseline){
 if(baseline.version!==VERSION||!Array.isArray(baseline.entries)||!Array.isArray(baseline.retired))throw Error('Unsupported provider baseline');
 const counts=new Map();for(const entry of baseline.entries){if(!entry.reason?.trim()||!Number.isSafeInteger(entry.count)||entry.count<1||!['import','usage'].includes(entry.kind))throw Error('Invalid exact provider exception');const id=key(entry);if(counts.has(id))throw Error('Duplicate provider exception');counts.set(id,entry.count);}
 const retired=new Set(baseline.retired.map(entry=>{if(!entry.reason?.trim())throw Error('Missing provider retirement reason');return key(entry);}));
 for(const id of retired)if(counts.has(id))throw Error('Provider identity cannot be both active and retired');
 const violations=[];for(const row of rows){const id=key(row),count=counts.get(id)??0;if(!retired.has(id)&&count)counts.set(id,count-1);else violations.push({...row,retired:retired.has(id)});}
 const unused=baseline.entries.filter(entry=>(counts.get(key(entry))??0)>0).map(entry=>({...entry,unusedCount:counts.get(key(entry))}));
 return {violations,accepted:rows.length-violations.length,retirements:unused};
}
