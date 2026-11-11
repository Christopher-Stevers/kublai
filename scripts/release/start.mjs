#!/usr/bin/env node
import { createServer } from 'node:http';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import next from 'next';
import { staticHandler } from './static-handler.mjs';

// Resolve once: a staged symlink switch must not mix two builds within a process.
const build = await realpath(process.env.NEXT_DIST_DIR ?? '.next');
process.env.NEXT_DIST_DIR = path.relative(process.cwd(), build);
const hostname = process.env.HOSTNAME_BIND ?? 'localhost';
const port = Number(process.env.PORT ?? 3000);
const runtime = path.join(build, 'runtime');
const app = next({ dev: false, hostname, port, dir: runtime });
await app.prepare();
const handleNext = app.getRequestHandler();
const handleStatic = staticHandler(path.join(build, 'static'));
const server = createServer(async (req, res) => {
  try { if (!(await handleStatic(req, res))) await handleNext(req, res); }
  catch (error) { console.error(error); if (!res.headersSent) res.writeHead(500); res.end(); }
});
server.listen(port, hostname, () => console.log(`ForemenHQ listening on http://${hostname}:${port}, build ${build}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
