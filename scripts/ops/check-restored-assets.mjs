import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
const [root, referencesFile] = process.argv.slice(2);
const references = JSON.parse(await readFile(referencesFile, 'utf8'));
let checked = 0; const missing = [];
for (const reference of references) {
  let filename;
  if (reference.kind === 'pdf') filename = `uploads/job-floor-plans/${reference.value}`;
  else {
    const url = new URL(reference.value, 'https://local.invalid');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/job-rooms/files/')) filename = `uploads/job-floor-plans/${pathname.slice('/api/job-rooms/files/'.length)}`;
    else if (pathname.startsWith('/api/catalogue/images/')) filename = `public/images/catalog/uploads/${pathname.slice('/api/catalogue/images/'.length)}`;
    else if (pathname.startsWith('/images/')) filename = `public${pathname}`;
    else continue; // Remote assets are not local-disk references.
  }
  const resolved = path.resolve(root, filename);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('Unsafe asset reference');
  checked++;
  try { await access(resolved); } catch { missing.push(filename); }
}
console.log(`Database asset references: ${checked} checked; ${missing.length} missing`);
if (missing.length) { console.error(JSON.stringify(missing.slice(0, 20))); process.exitCode = 1; }
