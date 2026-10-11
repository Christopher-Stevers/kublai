import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  rasterMorphology,
  rasterRust,
  rasterTypeScript,
  closeOpenSteps,
} from "./raster-native";

const originalCwd = process.cwd();
const binary = path.join(
  originalCwd,
  "native/room-raster/target/release/foreman-room-raster",
);

void test("native morphology matches TypeScript at borders, thin images, block boundaries and seeded random masks", async () => {
  let seed = 9173;
  let cases = 0;
  for (const [width, height] of [
    [1, 1],
    [1, 29],
    [29, 1],
    [2, 3],
    [7, 13],
    [31, 37],
    [65, 64],
    [257, 251],
  ]) {
    for (const radius of [0, 1, 2, 3, 8, 64, 256]) {
      const data = Uint8Array.from({ length: width! * height! }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % 5 === 0 ? 1 : 0;
      });
      const mask = { width: width!, height: height!, data };
      const before = data.slice();
      for (const steps of [
        [{ kind: "erode" as const, radius }],
        [{ kind: "dilate" as const, radius }],
        closeOpenSteps(radius, 1),
      ]) {
        const expected = rasterTypeScript(mask, steps);
        const actual = await rasterRust(mask, steps);
        assert.deepEqual(Uint8Array.from(actual.data), expected.data);
        assert.deepEqual(mask.data, before, "does not mutate input");
        cases++;
      }
    }
  }
  assert.equal(cases, 168);
});

void test("request validation rejects mismatched buffers, invalid radii and oversized dimensions", async () => {
  const steps = closeOpenSteps(2, 1);
  for (const mask of [
    { width: 2, height: 2, data: new Uint8Array(3) },
    { width: 8193, height: 1, data: new Uint8Array(8193) },
    { width: 0, height: 1, data: new Uint8Array(0) },
  ]) {
    await assert.rejects(rasterRust(mask, steps), /Invalid raster request/);
  }
  await assert.rejects(
    rasterRust({ width: 1, height: 1, data: new Uint8Array(1) }, [
      { kind: "erode", radius: -1 },
    ]),
    /Invalid raster request/,
  );
});

void test("binary rejects truncated payload and nonbinary pixels without output", () => {
  for (const payload of [[], [2]]) {
    const header = Buffer.alloc(24);
    header.write("FMR1");
    for (const offset of [4, 8, 12]) header.writeUInt32LE(1, offset);
    assert.throws(
      () =>
        execFileSync(binary, {
          input: Buffer.concat([header, Buffer.from(payload)]),
          stdio: ["pipe", "pipe", "pipe"],
        }),
      (error: unknown) => {
        assert.equal((error as { stdout: Buffer }).stdout.length, 0);
        return true;
      },
    );
  }
});

void test("disabled engine preserves the original results", async () => {
  const mask = { width: 40, height: 40, data: new Uint8Array(1600).fill(1) };
  const steps = closeOpenSteps(2, 1);
  assert.deepEqual(
    await rasterMorphology(mask, steps, "typescript"),
    rasterTypeScript(mask, steps),
  );
});

void test("concurrent native requests are bounded and the busy path falls back", async () => {
  const mask = {
    width: 512,
    height: 512,
    data: new Uint8Array(512 ** 2).fill(1),
  };
  const steps = closeOpenSteps(2, 1);
  const first = rasterRust(mask, steps);
  await assert.rejects(rasterRust(mask, steps), /Raster worker busy/);
  const fallback = await rasterMorphology(mask, steps);
  const native = await first;
  assert.deepEqual(Uint8Array.from(native.data), fallback.data);
});

void test("native failure falls back; malformed or oversized worker output is rejected; timeouts kill the child", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "foreman-raster-test-"));
  const mask = {
    width: 512,
    height: 512,
    data: new Uint8Array(512 ** 2).fill(1),
  };
  const steps = closeOpenSteps(2, 1);
  try {
    process.chdir(temp);
    assert.deepEqual(
      (await rasterMorphology(mask, steps)).data,
      rasterTypeScript(mask, steps).data,
    );
    await mkdir("native/room-raster/target/release", { recursive: true });
    const fake = "native/room-raster/target/release/foreman-room-raster";
    await writeFile(fake, "#!/bin/sh\ncat >/dev/null\nprintf broken\n", {
      mode: 0o700,
    });
    await assert.rejects(
      rasterRust(mask, steps),
      /Invalid raster worker response/,
    );
    await writeFile(
      fake,
      "#!/bin/sh\ncat >/dev/null\nhead -c 300000 /dev/zero\n",
      { mode: 0o700 },
    );
    await assert.rejects(rasterRust(mask, steps), /Raster worker failed/);
    // exec rather than a shell child ensures timeout termination leaves no process.
    await writeFile(fake, "#!/bin/sh\nexec sleep 60\n", { mode: 0o700 });
    const start = performance.now();
    await assert.rejects(rasterRust(mask, steps), /Raster worker failed/);
    assert.ok(performance.now() - start < 17000);
  } finally {
    process.chdir(originalCwd);
    await rm(temp, { recursive: true, force: true });
  }
});
