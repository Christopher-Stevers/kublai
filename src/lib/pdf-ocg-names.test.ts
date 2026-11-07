// @vitest-environment node
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  fallbackLayerNames,
  pdfOptionalContentNames,
  unnamedLayer,
} from "./pdf-ocg-names";

const bytes = (...parts: (string | Uint8Array)[]) =>
  Buffer.concat(
    parts.map((p) => (typeof p === "string" ? Buffer.from(p, "latin1") : p)),
  );

function objectStream(objects: [number, string][], extra = "") {
  let offset = 0;
  const header = objects
    .map(([num, body]) => {
      const entry = `${num} ${offset}`;
      offset += body.length + 1;
      return entry;
    })
    .join(" ");
  const first = header.length + 1;
  const packed = deflateSync(
    Buffer.from(`${header}\n${objects.map(([, b]) => `${b}\n`).join("")}`),
  );
  return bytes(
    `<</Type/ObjStm/N ${objects.length}/First ${first}/Filter/FlateDecode/Length ${packed.length}${extra}>>stream\r\n`,
    packed,
    "\r\nendstream\n",
  );
}

describe("unlisted PDF layer names", () => {
  it("reads plain and compressed optional content groups", async () => {
    const pdf = bytes(
      "%PDF-1.7\n",
      "4 0 obj\n<< /Type /OCG /Name (M-PLMB-SANI) >>\nendobj\n",
      "5 0 obj\n<< /Name <FEFF004D002D0044> /Type /OCG >>\nendobj\n",
      "9 0 obj\n",
      objectStream([
        [1394, "<</Name(M-PLMB-DHWT)/Type/OCG>>"],
        [1395, "<</Type/Font/Name(F1)>>"],
        [1396, "<</Type/OCG/Name(A\\(1\\) \\101)>>"],
      ]),
      "endobj\n",
      "10 0 obj\n",
      objectStream([[1397, "<</Type/OCG/Name(SKIPPED)>>"]], "/DecodeParms<</Predictor 12>>"),
      "endobj\n",
    );
    const names = await pdfOptionalContentNames(new Uint8Array(pdf));
    expect(Object.fromEntries(names)).toEqual({
      "4R": "M-PLMB-SANI",
      "5R": "M-D",
      "1394R": "M-PLMB-DHWT",
      "1396R": "A(1) A",
    });
  });

  it("reads the file only when pdf.js could not name a used layer", async () => {
    const data = new Uint8Array(
      bytes("%PDF\n", objectStream([[7, "<</Type/OCG/Name(M-PLMB-DHWT)>>"]])),
    );
    let reads = 0;
    const document = {
      getData: async () => {
        reads++;
        return data;
      },
    };
    const operators = (id: string) => ({
      fnArray: [70, 1],
      argsArray: [["OC", { type: "OCG", id }], null],
    });
    const optional = {
      getGroup: (id: string) => (id === "3R" ? { name: "LISTED" } : null),
    };
    expect(
      (await fallbackLayerNames(document, operators("3R"), 70, optional)).size,
    ).toBe(0);
    expect(reads).toBe(0);
    const names = await fallbackLayerNames(document, operators("7R"), 70, optional);
    expect(names.get("7R")).toBe("M-PLMB-DHWT");
    await fallbackLayerNames(document, operators("7R"), 70, optional);
    expect(reads).toBe(1);
  });

  it("recognizes unresolved layer ids", () => {
    expect(["1394R", "12R3"].every((id) => unnamedLayer(id))).toBe(true);
    expect(["M-PLMB-DHWT", "0", undefined, "R12"].some(unnamedLayer)).toBe(false);
  });
});
