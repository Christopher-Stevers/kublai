/** Packing-slip page detection against synthetic camera frames.
 * Every tenth frame has the page partly out of view and every tenth (offset
 * by five) has no page; neither should report a page.
 *
 *   node --import tsx scripts/benchmark-page-scanner.ts [frames] [--verbose]
 */
import { detectPage } from "../src/lib/scanning/page";
import { renderScene } from "../src/lib/scanning/test-scenes";

const frames = Number(process.argv[2] ?? 300);
const verbose = process.argv.includes("--verbose");
let found = 0,
  pages = 0,
  absent = 0,
  falsePositives = 0,
  error = 0,
  ms = 0;
const bySurface: Record<string, [number, number]> = {};
const failures: string[] = [];
for (let seed = 1; seed <= frames; seed++) {
  const scene = renderScene(
    seed,
    seed % 10 === 0 ? { clip: true } : seed % 10 === 5 ? { empty: true } : {},
  );
  const start = performance.now();
  const { quad } = detectPage(scene.data, scene.width, scene.height);
  ms += performance.now() - start;
  if (!scene.corners) {
    absent++;
    if (quad) {
      falsePositives++;
      failures.push(`${scene.name} reported a page`);
    }
    continue;
  }
  pages++;
  const surface = scene.name.split(":")[1]!.split("/")[0]!;
  const tally = (bySurface[surface] ??= [0, 0]);
  tally[1]++;
  if (!quad) {
    failures.push(`${scene.name} missed`);
    continue;
  }
  const worst = Math.max(
    ...quad.map((p, i) =>
      Math.hypot(
        (p.x - scene.corners![i]!.x) * scene.width,
        (p.y - scene.corners![i]!.y) * scene.height,
      ),
    ),
  );
  // Within 2% of the frame: close enough for the full-resolution refinement.
  if (worst < Math.max(scene.width, scene.height) * 0.02) {
    found++;
    error += worst;
    tally[0]++;
  } else failures.push(`${scene.name} off by ${worst.toFixed(1)} px`);
}
console.log(
  `found ${found}/${pages} (${((100 * found) / pages).toFixed(1)}%), mean worst-corner error ${(error / Math.max(1, found)).toFixed(2)} px, ` +
    `false pages ${falsePositives}/${absent}, ${(ms / frames).toFixed(1)} ms per frame`,
);
console.log(
  Object.entries(bySurface)
    .map(([surface, [ok, total]]) => `${surface} ${ok}/${total}`)
    .join("  "),
);
if (verbose) console.log(failures.join("\n"));
