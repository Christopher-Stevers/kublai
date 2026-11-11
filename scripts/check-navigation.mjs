#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { collectSources, inspectSources, checkRows } from './navigation/raw-navigation.mjs';
export async function checkNavigation(root=process.cwd(),baselinePath=new URL('./navigation/baseline.json',import.meta.url)) {
 const baseline=JSON.parse(await readFile(baselinePath,'utf8'));
 const result=checkRows(inspectSources(await collectSources(root)),baseline);
 for(const row of result.violations) console.error(`${row.file}:${row.line}: raw onClick navigation (${row.operations.join(', ')}). Use a shared press/navigation primitive or review an exact-handler exception with a narrow reason.`);
 console.log(`Navigation: ${result.violations.length} new/changed raw handlers; ${result.accepted} exact existing exceptions.`);
 if(result.violations.length)throw Error('Raw navigation speed-law gate failed');
 return result;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {await checkNavigation(process.argv[2] ? path.resolve(process.argv[2]) : process.cwd());}
 catch(error){console.error(error.message);process.exitCode=1;}
}
