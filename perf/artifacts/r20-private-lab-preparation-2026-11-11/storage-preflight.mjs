// Before any database: generated synthetic assets only, no private corpus.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const mode = process.argv[2];
if (!["compile", "full"].includes(mode)) throw Error("R20 storage phase required");
const root = `/tmp/foremanhq-r20-${mode}-storage`;
if (fs.existsSync(root)) throw Error("Fresh R20 storage output required");
fs.mkdirSync(root,{mode:0o700});
const cache = "/tmp/foremanhq-speed-app-5h2kmq";
if (!fs.existsSync(cache + "/PERF_LAB_ONLY"))
  throw Error("Synthetic cache marker absent");
const fixture = JSON.parse(fs.readFileSync(cache + "/perf/fixtures.json"));
if (
  fixture.provenance !== "isolated-seeded-app" ||
  fixture.productionDatabase !== false
)
  throw Error("Synthetic cache only");
const folder = fs.realpathSync(
  path.join(cache, "uploads/job-floor-plans", fixture.jobId, fixture.setId),
);
if (!folder.startsWith(cache + "/uploads/job-floor-plans/"))
  throw Error("Cache escape");
const assetManifest = [];
let bytes = 0,
  files = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name),
      s = fs.lstatSync(p);
    if (s.isSymbolicLink()) throw Error("Synthetic cache symlink");
    if (s.isDirectory()) walk(p);
    else if (s.isFile()) {
      files++;
      bytes += Math.max(s.size, s.blocks * 512);
      assetManifest.push({
        path: path.relative(folder, p),
        bytes: s.size,
        sha256: createHash("sha256").update(fs.readFileSync(p)).digest("hex"),
      });
    }
  }
}
walk(folder);
assetManifest.sort((a, b) => a.path.localeCompare(b.path));
const assetManifestBytes = JSON.stringify(assetManifest);
fs.writeFileSync(
  root + "/synthetic-cache-manifest.json",
  assetManifestBytes + "\n",
);
const cacheSHA256 = createHash("sha256")
  .update(assetManifestBytes)
  .digest("hex");
const available = fs.statfsSync("/tmp", { bigint: true });
// One private PG asset copy plus one new/refreshed app copy; compile adds2GiB for build/cache.
const requiredBytes = bytes * 2 + (mode === "compile" ? 2 * 1024 ** 3 : 0) + 512 * 1024 ** 2,
  requiredInodes = files * 2 + (mode === "compile" ? 30000 : 10000);
const quota = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      `
import ctypes,os,json,platform
if platform.system()!='Linux' or platform.machine()!='x86_64':raise RuntimeError('Quota syscall platform unsupported')
class D(ctypes.Structure):_fields_=[(n,ctypes.c_uint64) for n in ['bhardlimit','bsoftlimit','curspace','ihardlimit','isoftlimit','curinodes','btime','itime']]+[('valid',ctypes.c_uint32)]
lib=ctypes.CDLL(None,use_errno=True);d=D();fd=os.open('/tmp',os.O_RDONLY|os.O_DIRECTORY)
try:
 result=lib.syscall(443,fd,ctypes.c_int(0x80000700),os.getuid(),ctypes.byref(d))
 if result!=0 or d.valid&15!=15:raise RuntimeError('User quota unavailable')
 print(json.dumps({n:getattr(d,n) for n,_ in D._fields_}))
finally:os.close(fd)
`,
    ],
    { encoding: "utf8", timeout: 5000 },
  ),
);
const limits = [quota.bhardlimit, quota.bsoftlimit]
  .filter((value) => value > 0)
  .map((value) => value * 1024);
if (!limits.length) throw Error("Explicit quota bound required");
const quotaAvailableBytes = Math.min(...limits) - quota.curspace;
const inodeLimits = [quota.ihardlimit, quota.isoftlimit].filter(
  (value) => value > 0,
);
const quotaAvailableInodes = inodeLimits.length
  ? Math.min(...inodeLimits) - quota.curinodes
  : null;
const report = {
  quota,
  cacheSHA256,
  quotaAvailableBytes,
  quotaAvailableInodes,
  syntheticCache: folder,
  assetBytes: bytes,
  assetFiles: files,
  requiredBytes,
  requiredInodes,
  availableBytes: Number(available.bavail * available.bsize),
  availableInodes: Number(available.ffree),
  quotaProbeBytes: 32 * 1024 ** 2,
  quotaProbeFiles: 256,
  quotaProbePassed: false,
};
const probe = path.join(root, "owned-quota-probe");
try {
  if (
    report.availableBytes < requiredBytes ||
    quotaAvailableBytes < requiredBytes ||
    report.availableInodes < requiredInodes ||
    (quotaAvailableInodes !== null && quotaAvailableInodes < requiredInodes)
  )
    throw Error("Synthetic copy peak storage bound");
  fs.mkdirSync(probe, { mode: 0o700 });
  const fd = fs.openSync(probe + "/blocks", "wx");
  try {
    const chunk = Buffer.alloc(1024 ** 2);
    for (let i = 0; i < 32; i++) fs.writeSync(fd, chunk);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  for (let i = 0; i < 256; i++)
    fs.writeFileSync(path.join(probe, String(i)), "probe", { flag: "wx" });
  report.quotaProbePassed = true;
} catch (error) {
  report.failure = {
    name: error.name,
    code: error.code ?? null,
    message: error.message,
  };
  throw error;
} finally {
  fs.rmSync(probe, { recursive: true, force: true });
  fs.writeFileSync(
    root + "/storage-preflight.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
