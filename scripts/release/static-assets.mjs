import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

export async function files(dir, prefix = '') {
  const result = [];
  for (const item of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const name = path.join(prefix, item.name);
    if (item.isDirectory()) result.push(...await files(dir, name));
    else if (item.isFile() && !/\.(br|gz)$/.test(name)) result.push(name);
  }
  return result.sort();
}

// New output wins; an identical URL with different bytes must never be deployed.
export async function retainStatic(previous, next) {
  let names;
  try { names = await files(previous); } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  let retained = 0;
  for (const name of names) {
    const old = await readFile(path.join(previous, name));
    try {
      const current = await readFile(path.join(next, name));
      if (!old.equals(current)) throw Error(`Static URL collision: ${name}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(path.dirname(path.join(next, name)), { recursive: true });
      await copyFile(path.join(previous, name), path.join(next, name));
      retained++;
    }
  }
  return retained;
}

export async function compressStatic(dir) {
  let raw = 0, brotli = 0, gzip = 0, count = 0;
  for (const name of await files(dir)) {
    if (!/\.(js|css|json|svg|txt|wasm)$/.test(name)) continue;
    const data = await readFile(path.join(dir, name));
    const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } });
    const gz = gzipSync(data, { level: 9 });
    await writeFile(path.join(dir, name + '.br'), br);
    await writeFile(path.join(dir, name + '.gz'), gz);
    raw += data.length; brotli += br.length; gzip += gz.length; count++;
  }
  return { count, raw, brotli, gzip };
}
