import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

const types = { '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
export function acceptsEncoding(header, encoding) {
  const values = String(header ?? '').split(',').map(part => part.trim().split(';'));
  const entry = values.find(([name]) => name === encoding) ?? values.find(([name]) => name === '*');
  return !!entry && !entry.slice(1).some(value => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(value));
}
export function staticHandler(directory) {
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) return false;
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { return false; }
    if (!pathname.startsWith('/_next/static/')) return false;
    const relative = pathname.slice('/_next/static/'.length);
    if (relative.split('/').some(part => part === '..' || part === '.') || relative.includes('\\') || relative.includes('\0') || /\.(br|gz)$/.test(relative)) return false;
    const base = path.join(directory, relative);
    let file, info, encoding;
    for (const [suffix, candidateEncoding] of [['.br', 'br'], ['.gz', 'gzip'], ['', undefined]]) {
      if (candidateEncoding && !acceptsEncoding(req.headers['accept-encoding'], candidateEncoding)) continue;
      try { info = await stat(base + suffix); if (!info.isFile()) continue; }
      catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue; throw error; }
      file = base + suffix; encoding = candidateEncoding; break;
    }
    if (!file) return false;
    res.setHeader('Content-Type', types[path.extname(base)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', info.size);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Vary', 'Accept-Encoding');
    if (encoding) res.setHeader('Content-Encoding', encoding);
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).on('error', () => res.destroy()).pipe(res);
    return true;
  };
}
