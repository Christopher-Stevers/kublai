import { parseNameKeywordGroups } from "./material-list-sort";
import { describe, expect, it } from "vitest";
import {
  sortMaterialListItems,
  sortMaterialListPartChoices,
} from "./material-list-sort";
function item(
  id: string,
  name: string,
  material: string | null = "XFR",
  createdAt: string | null = null,
) {
  return {
    id,
    partDefinitionId: id,
    createdAt,
    partDefinition: { id, displayName: name, material },
  };
}
const ids = (items: ReturnType<typeof item>[]) => items.map((x) => x.id);
describe("material list sorting", () => {
  it("groups material, numeric size and name without type priority without mutating the list", () => {
    const items = [
      item("ten", '10" Pipe'),
      item("tee", '2" Tee'),
      item("cu", '2" Copper Pipe', "Copper"),
      item("coupling", '2" Coupling'),
      item("elbow", '2" 90'),
      item("pipe", '2" Pipe'),
    ];
    const before = [...items];
    expect(ids(sortMaterialListItems(items, "material"))).toEqual([
      "cu",
      "elbow",
      "coupling",
      "pipe",
      "tee",
      "ten",
    ]);
    expect(items).toEqual(before);
  });
  it("compares fractions and unicode mixed numbers by actual size", () => {
    const items = [
      item("onehalf", '1½" Pipe'),
      item("quarter", '1/4" Pipe'),
      item("onequarter", '1-1/4" Pipe'),
      item("half", '½" Pipe'),
      item("threequarter", '3/4" Pipe'),
      item("one", '1" Pipe'),
    ];
    expect(ids(sortMaterialListItems(items, "material"))).toEqual([
      "quarter",
      "half",
      "threequarter",
      "one",
      "onequarter",
      "onehalf",
    ]);
  });
  it("uses catalogue dimensions instead of fitting angles or pipe lengths", () => {
    const items = [item("b", "90 degree elbow"), item("a", "Pipe 12 ft")];
    const catalogue = [
      {
        id: "b",
        displayName: "90 degree elbow",
        material: "XFR",
        sizeNominal: "25.4",
        sizeUnit: "mm",
      },
      {
        id: "a",
        displayName: "Pipe 12 ft",
        material: "XFR",
        sizeNominal: "2",
        sizeUnit: "in",
      },
    ];
    expect(ids(sortMaterialListItems(items, "material", catalogue))).toEqual([
      "b",
      "a",
    ]);
  });
  it("keeps unknown materials and sizes last", () => {
    expect(
      ids(
        sortMaterialListItems(
          [
            item("unknown", "90 degree elbow"),
            item("known", '10" Pipe'),
            item("no-material", '1" Pipe', null),
          ],
          "material",
        ),
      ),
    ).toEqual(["known", "unknown", "no-material"]);
  });
  it("sorts by current selected supplier and leaves unassigned items last", () => {
    const rows = [
      { ...item("b", '2" Pipe'), supplierId: "b" },
      {
        ...item("a", '2" Pipe'),
        supplierId: "a",
        supplierPart: {
          supplierId: "old",
          supplier: { name: "Z old supplier" },
        },
      },
      item("none", '2" Pipe'),
    ];
    expect(
      ids(
        sortMaterialListItems(
          rows,
          "supplier",
          [],
          [
            { id: "a", name: "Alpha" },
            { id: "b", name: "Beta" },
          ],
        ),
      ),
    ).toEqual(["a", "b", "none"]);
  });
  it("puts newest items first, uses creation not edit time, and handles missing dates", () => {
    const rows = [
      item("old", '1" Pipe', "XFR", "2026-01-01"),
      item("new", '2" Pipe', "XFR", "2026-02-01"),
      item("unknown", '1/2" Pipe', "XFR", "invalid"),
    ];
    expect(ids(sortMaterialListItems(rows, "recent"))).toEqual([
      "new",
      "old",
      "unknown",
    ]);
  });
  it("places new items automatically and keeps tie order deterministic", () => {
    const a = item("a", '2" Pipe'),
      b = item("b", '2" Pipe');
    expect(
      ids(sortMaterialListItems([b, a, item("small", '1" Pipe')], "material")),
    ).toEqual(["small", "a", "b"]);
    expect(ids(sortMaterialListItems([a, b], "material"))).toEqual(["a", "b"]);
  });
  it("keeps custom description-only items available", () => {
    const rows = [{ id: "custom", descriptionSnapshot: "Custom part" }];
    expect(sortMaterialListItems(rows, "material")).toEqual(rows);
  });
});

describe("Add menu part ordering", () => {
  it("matches material-list ordering using catalogue sizes and preserves choices", () => {
    const parts = [
      {
        id: "ten",
        displayName: '10" Pipe',
        material: "XFR",
        sizeNominal: 10,
        sizeUnit: "in",
        imageUrl: "ten.webp",
      },
      {
        id: "tee",
        displayName: '2" Tee',
        material: "XFR",
        sizeNominal: 2,
        sizeUnit: "in",
        imageUrl: "tee.webp",
      },
      {
        id: "pipe",
        displayName: '2" Pipe',
        material: "XFR",
        sizeNominal: 2,
        sizeUnit: "in",
        imageUrl: "pipe.webp",
      },
      {
        id: "half",
        displayName: '1/2" Pipe',
        material: "XFR",
        sizeNominal: "1/2",
        sizeUnit: "in",
        imageUrl: "half.webp",
      },
    ];
    const original = [...parts];
    for (const mode of ["material", "supplier", "recent"] as const) {
      const choices = sortMaterialListPartChoices(parts, mode);
      const list = sortMaterialListItems(
        parts.map((p) => ({ id: p.id, partDefinitionId: p.id })),
        mode,
        parts,
      );
      expect(choices.map((p) => p.id)).toEqual(list.map((p) => p.id));
      expect(choices.map((p) => p.id)).toEqual(["half", "pipe", "tee", "ten"]);
      expect(choices[0]).toBe(parts[3]);
    }
    expect(parts).toEqual(original);
  });
});

it("uses actual category before name, after material and size, in lists and Add choices", () => {
  const categories = [
    { id: "p", name: "Pipe" },
    { id: "f", name: "Fittings" },
  ];
  const parts = [
    {
      id: "pipe",
      displayName: '2" A Pipe',
      material: "XFR",
      sizeNominal: 2,
      sizeUnit: "in",
      categoryId: "p",
    },
    {
      id: "z",
      displayName: '2" Z Pipe',
      material: "XFR",
      sizeNominal: 2,
      sizeUnit: "in",
      categoryId: "f",
    },
    {
      id: "a",
      displayName: '2" A Tee',
      material: "XFR",
      sizeNominal: 2,
      sizeUnit: "in",
      categoryId: "f",
    },
    {
      id: "unknown",
      displayName: '2" A Unknown',
      material: "XFR",
      sizeNominal: 2,
      sizeUnit: "in",
      categoryId: null,
    },
    {
      id: "small",
      displayName: '1" Pipe',
      material: "XFR",
      sizeNominal: 1,
      sizeUnit: "in",
      categoryId: "p",
    },
    {
      id: "copper",
      displayName: '3" Pipe',
      material: "Copper",
      sizeNominal: 3,
      sizeUnit: "in",
      categoryId: "p",
    },
  ];
  for (const mode of ["material", "supplier", "recent"] as const) {
    const expected = ["copper", "small", "a", "z", "pipe", "unknown"];
    expect(
      sortMaterialListPartChoices(parts, mode, categories).map((p) => p.id),
    ).toEqual(expected);
    expect(
      sortMaterialListItems(
        parts.map((p) => ({ id: p.id, partDefinitionId: p.id })),
        mode,
        parts,
        [],
        categories,
      ).map((p) => p.id),
    ).toEqual(expected);
  }
});

it("sorts names by user keyword groups, respecting category and whole-word boundaries", () => {
  const parts = [
    { id: "other", displayName: '2" Capacity 190', categoryId: "f" },
    { id: "adapter", displayName: '2" ADAPTOR', categoryId: "f" },
    { id: "elbow", displayName: '2" Elbow 90', categoryId: "f" },
    { id: "cap", displayName: '2" Cap', categoryId: "f" },
    { id: "phrase", displayName: '2" Long-turn elbow', categoryId: "f" },
    { id: "pipe", displayName: '2" Pipe', categoryId: "p" },
    { id: "unknown", displayName: '2" Pipe', categoryId: null },
  ].map((p) => ({ ...p, material: "XFR", sizeNominal: 2, sizeUnit: "in" }));
  const categories = [
    { id: "f", name: "Fittings" },
    { id: "p", name: "Pipe" },
  ];
  const groups = ["pipe, long turn", "adapter, adaptor", "90, elbow", "cap"];
  const expected = [
    "phrase",
    "adapter",
    "elbow",
    "cap",
    "other",
    "pipe",
    "unknown",
  ];
  for (const mode of ["material", "supplier", "recent"] as const) {
    expect(
      sortMaterialListPartChoices(parts, mode, categories, groups).map(
        (p) => p.id,
      ),
    ).toEqual(expected);
    expect(
      sortMaterialListItems(
        parts.map((p) => ({ id: p.id, partDefinitionId: p.id })),
        mode,
        parts,
        [],
        categories,
        groups,
      ).map((p) => p.id),
    ).toEqual(expected);
  }
  expect(
    sortMaterialListPartChoices(parts, "material", categories, [
      "cap",
      ...groups,
    ]).map((p) => p.id)[0],
  ).toBe("cap");
  expect(
    sortMaterialListPartChoices(parts, "material", categories, [
      " , ",
      ".*",
    ]).map((p) => p.id),
  ).toEqual(
    sortMaterialListPartChoices(parts, "material", categories).map((p) => p.id),
  );
});

it("excludes reducing 90s from the 90 group without hiding them, and permits later groups", () => {
  const parts = ["Reducing 90", "90", "190", "Reducing 45", "Cap"].map(
    (displayName, i) => ({
      id: String(i),
      displayName,
      material: "XFR",
      sizeNominal: 2,
      sizeUnit: "in",
      categoryId: "f",
    }),
  );
  const groups = [
    { includes: "90", excludes: "reducing" },
    { includes: "cap", excludes: "" },
    { includes: "reducing", excludes: "45" },
  ];
  const categories = [{ id: "f", name: "Fittings" }];
  const expected = ["90", "Cap", "Reducing 90", "190", "Reducing 45"];
  expect(
    sortMaterialListPartChoices(parts, "material", categories, groups).map(
      (p) => p.displayName,
    ),
  ).toEqual(expected);
  expect(
    sortMaterialListItems(
      parts.map((p) => ({ id: p.id, partDefinitionId: p.id })),
      "material",
      parts,
      [],
      categories,
      groups,
    ).map((p) => parts[Number(p.id)]!.displayName),
  ).toEqual(expected);
  expect(
    sortMaterialListPartChoices(parts, "material", categories, [
      { includes: "90", excludes: "REDUCING 90" },
    ])[0]?.displayName,
  ).toBe("90");
  expect(
    sortMaterialListPartChoices(parts, "material", categories, [
      { includes: "", excludes: "cap" },
    ]),
  ).toHaveLength(parts.length);
});
it("migrates old keyword groups to includes without exclusions", () => {
  expect(
    parseNameKeywordGroups([
      "90, elbow",
      { includes: "cap", excludes: "test" },
      null,
      3,
    ]),
  ).toEqual([
    { includes: "90, elbow", excludes: "" },
    { includes: "cap", excludes: "test" },
  ]);
  expect(parseNameKeywordGroups(null)).toEqual([]);
});

it("sorts catalog before material, size, category and keyword priority in lists and Add parts", () => {
  const catalogs = [{id:"hardware",name:"Hardware"},{id:"plumbing",name:"Plumbing"}];
  const parts = [
    {id:"plumbing",catalogId:"plumbing",material:"Copper",displayName:'1" 90',sizeNominal:1,sizeUnit:"in"},
    {id:"hardware",catalogId:"hardware",material:"Steel",displayName:'8" Pipe',sizeNominal:8,sizeUnit:"in"},
    {id:"unknown",catalogId:null,material:"Aluminum",displayName:'1" 90',sizeNominal:1,sizeUnit:"in"},
  ];
  expect(sortMaterialListPartChoices(parts,"material",[],["90"],catalogs).map(p=>p.id)).toEqual(["hardware","plumbing","unknown"]);
  expect(sortMaterialListItems(parts.map(p=>({id:p.id,partDefinitionId:p.id})),"material",parts,[],[],["90"],catalogs).map(p=>p.id)).toEqual(["hardware","plumbing","unknown"]);
});
