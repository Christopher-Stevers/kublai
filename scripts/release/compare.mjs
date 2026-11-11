#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { files } from './static-assets.mjs';
const [left, right] = process.argv.slice(2);
if (!left || !right) throw Error('Usage: node scripts/release/compare.mjs /first/build /second/build');
const scriptFiles = async dir => (await files(path.join(dir, 'static'))).filter(name => name.endsWith('.js'));
const a = await scriptFiles(left), b = await scriptFiles(right);
const onlyLeft = a.filter(name => !b.includes(name)), onlyRight = b.filter(name => !a.includes(name));
const different = [];
for (const name of a.filter(name => b.includes(name))) {
  if (!(await readFile(path.join(left, 'static', name))).equals(await readFile(path.join(right, 'static', name)))) different.push(name);
}
console.log(JSON.stringify({ left: a.length, right: b.length, identical: a.length - onlyLeft.length - different.length, onlyLeft, onlyRight, different }, null, 2));
if (onlyLeft.length || onlyRight.length || different.length) process.exitCode = 1;
