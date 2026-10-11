import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimatePartCost,
  primaryDiameter,
  estimateNote,
  SIMULATION_MARKER,
} from "./simulated-part-cost.mjs";

const fitting = (size, material = "ABS", name = "Coupling") => ({
  displayName: `${size}" ${material} ${name}`,
  material,
  nominal: String(size),
  sizeUnit: "in",
  category: "Fitting",
  catalog: "Plumbing",
});

test("larger fittings and premium materials cost more", () => {
  assert.ok(
    +estimatePartCost(fitting(6)).unitCost >
      +estimatePartCost(fitting(2)).unitCost,
  );
  assert.ok(
    +estimatePartCost(fitting(2, "XFR")).unitCost >
      +estimatePartCost(fitting(2)).unitCost,
  );
  assert.ok(
    +estimatePartCost(fitting(0.5, "Copper Press")).unitCost >
      +estimatePartCost(fitting(0.5, "Copper")).unitCost,
  );
  assert.ok(
    +estimatePartCost(fitting(2, "ABS", "Tee")).unitCost >
      +estimatePartCost(fitting(2)).unitCost,
  );
});

test("pipe price includes its listed length or coil", () => {
  const pipe = { ...fitting(0.5, "Pex"), category: "Pipe" };
  const short = estimatePartCost({
    ...pipe,
    displayName: '1/2" Pex Pipe 100 ft Coil',
  });
  const long = estimatePartCost({
    ...pipe,
    displayName: "1/2\" X 300' AQUAPEX WHITE",
  });
  assert.ok(+long.unitCost > +short.unitCost * 2.5);
  assert.equal(long.basis, "per 300 ft coil");
  const conflict = estimatePartCost({
    ...fitting(2, "XFR"),
    category: "Pipe",
    displayName: '2" XFR Pipe 12 ft',
    description: "Pipe 10 ft",
  });
  assert.equal(conflict.basis, "per 12 ft length");
});

test("mixed fractions and explicit inches override imported metric metadata", () => {
  assert.equal(
    primaryDiameter({ displayName: '1-1/2" ABS Elbow' }).inches,
    1.5,
  );
  assert.equal(
    primaryDiameter({ displayName: '1 1/2" x 1/2" Tee' }).inches,
    1.5,
  );
  assert.equal(
    primaryDiameter({
      displayName: '10" x 200 mm Bushing',
      nominal: "10",
      sizeUnit: "mm",
    }).inches,
    10,
  );
  assert.ok(
    Math.abs(
      primaryDiameter({ displayName: "200 mm Coupling" }).inches - 200 / 25.4,
    ) < 0.001,
  );
});

test("malformed imported sizes get a bounded, explicitly flagged allowance", () => {
  const part = {
    ...fitting(2, "PVC Sch 80"),
    displayName: '854080" PVC Sch 80 Flange',
    nominal: "854080",
    sizeLabel: '854080"',
  };
  const estimate = estimatePartCost(part);
  assert.ok(+estimate.unitCost < 100);
  assert.match(estimate.warnings.join(" "), /malformed/);
});

test("hardware uses piece prices and repeatable estimates", () => {
  const screw = {
    displayName: "#10 X 3/4 HEX HEAD SELF DRILL (Box = 100pcs)",
    catalog: "Hardware",
  };
  const cost = estimatePartCost(screw);
  assert.ok(+cost.unitCost > 0 && +cost.unitCost < 0.5);
  assert.equal(cost.basis, "per screw");
  assert.deepEqual(
    estimatePartCost({ ...screw, id: "a" }),
    estimatePartCost({ ...screw, id: "b" }),
  );
  assert.ok(
    +estimatePartCost({
      displayName: "20V MAX BRUSHLESS SDS ROTARY HAMMER",
      catalog: "Hardware",
    }).unitCost > 300,
  );
});

test("pipe clips and miscategorized compression fittings are not priced as coils", () => {
  const part = { ...fitting(0.5, "Pex"), category: "Pipe" };
  const clip = estimatePartCost({ ...part, displayName: '1/2" Pex Pipe Clip' });
  assert.equal(clip.rule, "pipe support");
  assert.ok(+clip.unitCost < 2);
  assert.equal(
    estimatePartCost({
      ...part,
      displayName: '1/2" Pex Compression For Pex With Inserts',
    }).rule,
    "fitting",
  );
});

test("notes identify estimates, units, exclusions, and assumptions", () => {
  const estimate = estimatePartCost({
    ...fitting(2),
    category: "Pipe",
    displayName: '2" ABS Pipe',
  });
  const note = estimateNote(estimate);
  assert.ok(note.includes(SIMULATION_MARKER));
  assert.match(note, /SIMULATED ESTIMATE ONLY/);
  assert.match(note, /before tax, freight and markup/);
  assert.match(note, /assumed standard length/);
});
