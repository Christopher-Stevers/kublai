// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  buildCatalogueWorkbook,
  normalizeCatalogueImportRows,
  parseCatalogueWorkbook,
} from "./catalogue-xlsx-core";
const rows = [
  {
    partId: "one",
    catalog: "Plumbing",
    displayName: "½ inch – elbow",
    description: "",
    sizeNominal: 0.5,
    sizeUnit: "in",
    aliases: "elbow\n90°",
    isActive: false,
  },
  {
    catalog: "Tools",
    displayName: "Drill",
    description: "Portable",
    sizeNominal: null,
    sizeUnit: "",
    aliases: "",
    isActive: true,
  },
];
describe("catalogue workbook fidelity", () => {
  it("exports the same sheet names, headers, values and cell types", async () => {
    const buffer = await buildCatalogueWorkbook(rows);
    const actual = XLSX.read(buffer, { type: "array" });
    const expected = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      expected,
      XLSX.utils.json_to_sheet(rows),
      "Parts",
    );
    const reference = XLSX.read(
      XLSX.write(expected, { type: "array", bookType: "xlsx" }),
      { type: "array" },
    );
    expect(actual.SheetNames).toEqual(reference.SheetNames);
    expect(actual.Sheets).toEqual(reference.Sheets);
    expect(await parseCatalogueWorkbook(buffer)).toEqual(
      normalizeCatalogueImportRows(rows),
    );
  });
  it.each(["xlsx", "xls"] as const)(
    "reads the first %s worksheet and preserves friendly header aliases",
    async (bookType) => {
      const friendly = [
        {
          Catalog: "  Plumbing ",
          "Display Name": "Elbow",
          Description: "",
          "Size Nominal": 0.5,
          "Size Unit": "in",
          "Is Active": false,
        },
        { Catalog: "", "Display Name": "Dropped" },
      ];
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(friendly),
        "Supplier parts",
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(rows),
        "Ignored second sheet",
      );
      const buffer = XLSX.write(workbook, {
        type: "array",
        bookType,
      }) as ArrayBuffer;
      expect(await parseCatalogueWorkbook(buffer)).toEqual(
        normalizeCatalogueImportRows(friendly),
      );
    },
  );
  it("round-trips large backups without dropping IDs, empty fields or inactive rows", async () => {
    const large = Array.from({ length: 1000 }, (_, i) => ({
      ...rows[i % 2]!,
      partId: `part-${i}`,
      displayName: `Part ${i}`,
      notes: `Note ${i}`,
      isActive: i % 5 !== 0,
    }));
    const workbook = XLSX.read(await buildCatalogueWorkbook(large), {
      type: "array",
    });
    expect(
      XLSX.utils.sheet_to_json(workbook.Sheets.Parts!, { defval: "" }),
    ).toEqual(
      large.map((row) => ({ ...row, sizeNominal: row.sizeNominal ?? "" })),
    );
  });
});
