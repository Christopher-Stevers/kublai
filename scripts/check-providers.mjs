#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {collectSources} from './navigation/raw-navigation.mjs';
import {inspectProviders,checkProviders} from './layout/shared-providers.mjs';
export async function checkSharedProviders(root=process.cwd(),baselinePath=new URL('./layout/provider-baseline.json',import.meta.url)){
 const result=checkProviders(inspectProviders(await collectSources(root)),JSON.parse(await readFile(baselinePath,'utf8')));
 for(const row of result.violations)console.error(`${row.owner}:${row.line}: ${row.retired?'reintroduced':'new'} shared-layout provider ${row.kind} ${row.module}#${row.export} (layout ${row.layout}). Review this exact boundary; no blanket file exceptions.`);
 console.log(`Providers: ${result.violations.length} new/reintroduced shared boundaries; ${result.accepted} existing imports/usages; ${result.retirements.length} removable exceptions.`);
 if(result.violations.length)throw Error('Shared-layout provider speed-law gate failed');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{await checkSharedProviders(process.argv[2]?path.resolve(process.argv[2]):process.cwd());}catch(error){console.error(error.message);process.exitCode=1;}
