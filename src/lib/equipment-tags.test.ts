import { expect, it } from "vitest";
import {
  containsEquipmentTag,
  equipmentDrawingDestination,
  equipmentTagCandidates,
  equipmentTagLocations,
} from "./equipment-tags";
import { readSnapshotState } from "./snapshot-source";
const word = { text: "HEX-2", left: 0.2, top: 0.3, right: 0.25, bottom: 0.32 };
it("matches the full tag while tolerating spacing and dash variants", () => {
  for (const text of ["HEX-2", "HX HEX – 2 FOR EQUIPMENT", "hex 2"])
    expect(containsEquipmentTag(text, "HEX-2")).toBe(true);
  for (const text of ["HEX-20", "HEX-2A", "AHEX-2", "HEX-21", "HEX-2-1"])
    expect(containsEquipmentTag(text, "HEX-2")).toBe(false);
  expect(containsEquipmentTag("HEX-2", "HEX2")).toBe(true);
});
it("reads only tags in the drawn hyperlink and leaves multiple candidates explicit", () => {
  expect(
    equipmentTagCandidates(
      [word, { ...word, text: "FCU-1", left: 0.8, right: 0.9 }],
      [
        { x: 0.1, y: 0.2 },
        { x: 0.3, y: 0.4 },
      ],
    ),
  ).toEqual(["HEX-2"]);
  expect(
    equipmentTagCandidates(
      [word, { ...word, text: "FCU-1", left: 0.26, right: 0.3 }],
      [
        { x: 0.1, y: 0.2 },
        { x: 0.4, y: 0.4 },
      ],
    ),
  ).toEqual(["HEX-2", "FCU-1"]);
});
it("joins text fragments for a tag and preserves their visual location", () => {
  const words = [
    { ...word, text: "HEX", right: 0.23 },
    { ...word, text: "-", left: 0.231, right: 0.235 },
    { ...word, text: "2", left: 0.236 },
  ];
  expect(equipmentTagLocations(words, "HEX-2")).toEqual([
    expect.objectContaining({ left: 0.2, right: 0.25 }),
  ]);
});
it("saves an internal drawing destination with zoom and page without a search highlight", () => {
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const source = equipmentDrawingDestination({
    jobId: id,
    setId: id,
    sheetId: id,
    sourceSheetId: id,
    name: "M-101",
    tag: "HEX-2",
    box: word,
  });
  const url = new URL(source.href, "https://example.test");
  expect(readSnapshotState(url.hash)?.drawing?.highlight).toBeUndefined();
  expect(url.searchParams.get("drawingSheet")).toBe(id);
  expect(readSnapshotState(url.hash)?.drawing).toMatchObject({
    sourceSheetId: id,
    search: "",
    viewport: { center: { x: 0.225, y: 0.31 } },
  });
});

const pageBox = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const line = (text: string, top = 0.2, left = 0.1) => ({
  text,
  left,
  right: left + text.length * 0.004,
  top,
  bottom: top + 0.01,
});
it("rejects room numbers, area text, revision references and ordinary prose in automatic detection", () => {
  const words = [
    "N101",
    "S118",
    "M-102",
    "ISSUED FOR SI-M09",
    "DIVISION 22",
    "MINIMUM 1% SLOPE",
    "AISLE 24",
    "270 SF 283 SF",
    "P12RA",
    "BSQ-120",
  ].map((text, i) => line(text, 0.05 + i * 0.03));
  expect(equipmentTagCandidates(words, pageBox, { automatic: true })).toEqual(
    [],
  );
});
it("does not invent a supply-fan tag across separate rooms' area labels", () => {
  const words = [
    {
      text: "260 SF",
      left: 0.195,
      right: 0.2042,
      top: 0.3011,
      bottom: 0.30495,
    },
    {
      text: "260 SF",
      left: 0.221,
      right: 0.2303,
      top: 0.3011,
      bottom: 0.30495,
    },
  ];
  expect(equipmentTagCandidates(words, pageBox, { automatic: true })).toEqual(
    [],
  );
  expect(equipmentTagLocations(words, "SF-260")).toEqual([]);
});
it("recognizes grouped schedule suffixes and numbers without inventing the unqualified tag", () => {
  for (const [text, expected] of [
    ["SF-7 A/B", ["SF-7A", "SF-7B"]],
    ["SP-1 A&B", ["SP-1A", "SP-1B"]],
    ["AC-1 A/B/C", ["AC-1A", "AC-1B", "AC-1C"]],
    ["P-1A/B", ["P-1A", "P-1B"]],
    ["DCWP-1&2", ["DCWP-1", "DCWP-2"]],
    ["HWBP-1/2", ["HWBP-1", "HWBP-2"]],
  ] as const) {
    const words = [line(text)];
    expect(
      equipmentTagCandidates(words, pageBox, {
        automatic: true,
        knownTags: [...expected],
      }),
    ).toEqual(expected);
    for (const tag of expected) {
      expect(containsEquipmentTag(text, tag)).toBe(true);
      expect(equipmentTagLocations(words, tag)).toHaveLength(1);
    }
    const boxes = expected.map((tag) => equipmentTagLocations(words, tag)[0]!);
    for (let index = 1; index < boxes.length; index++)
      expect(boxes[index - 1]!.right).toBeLessThanOrEqual(boxes[index]!.left);
  }
  expect(containsEquipmentTag("AC-1 A/B/C", "AC-1")).toBe(false);
  expect(containsEquipmentTag("AC-1 A/B/C", "AC-1D")).toBe(false);
});
it("retains full compound tags and handles sentence punctuation and compact equipment names", () => {
  expect(
    equipmentTagCandidates(
      [
        line("RISER FROM MUA-2. REFER TO M-600."),
        line("VRF-CU-1", 0.3),
        line("FCU2", 0.4),
      ],
      pageBox,
      { automatic: true },
    ),
  ).toEqual(["MUA-2", "VRF-CU-1", "FCU-2"]);
  expect(containsEquipmentTag("VRF-CU-1", "CU-1")).toBe(false);
  expect(containsEquipmentTag("ADD-M01", "M-01")).toBe(false);
});
it("uses tight locations for multiple tags inside a PDF note instead of the whole sentence", () => {
  const words = [line("CONNECT WC-1, LAV-1 AND FD-2.")];
  const [wc] = equipmentTagLocations(words, "WC-1"),
    [lav] = equipmentTagLocations(words, "LAV-1");
  expect(wc!.right).toBeLessThan(lav!.left);
  expect(wc!.right - wc!.left).toBeLessThan(0.02);
  expect(
    equipmentTagCandidates(words, [
      { x: wc!.left, y: 0.19 },
      { x: wc!.right, y: 0.22 },
    ]),
  ).toEqual(["WC-1"]);
});
it("recognizes aligned stacked equipment bubbles, without turning room names into tags", () => {
  const words = [
    line("HEX", 0.2, 0.2),
    { ...line("2", 0.215, 0.204), right: 0.208 },
    line("LOBBY", 0.4, 0.4),
    line("101", 0.415, 0.404),
  ];
  expect(equipmentTagCandidates(words, pageBox, { automatic: true })).toEqual([
    "HEX-2",
  ]);
  expect(equipmentTagLocations(words, "HEX-2")[0]).toMatchObject({
    top: 0.2,
    bottom: 0.225,
  });
});
it("learns unfamiliar equipment names from schedule tag columns, excluding model columns and distant tables", async () => {
  const { equipmentScheduleTags } = await import("./equipment-tags");
  const words = [
    line("EQUIPMENT SCHEDULE", 0.05),
    line("TAG", 0.1, 0.1),
    line("MODEL", 0.1, 0.4),
    line("ZBC-7", 0.13, 0.096),
    line("MODEL-88", 0.13, 0.4),
    line("A87-150-243-2000", 0.8, 0.07),
  ];
  const knownTags = equipmentScheduleTags([{ words }]);
  expect(knownTags).toEqual(["ZBC-7"]);
  expect(
    equipmentTagCandidates([line("ZBC-7")], pageBox, {
      automatic: true,
      knownTags,
    }),
  ).toEqual(["ZBC-7"]);
  expect(
    equipmentTagCandidates([line("ZBC-7")], pageBox, { automatic: true }),
  ).toEqual([]);
  // Selecting an unfamiliar explicit tag manually remains supported.
  expect(equipmentTagCandidates([line("ZBC-7")], pageBox)).toEqual(["ZBC-7"]);
});
