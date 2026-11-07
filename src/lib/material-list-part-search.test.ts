import { expect, it } from "vitest";
import {
  materialListPartSearchText,
  matchesMaterialListPart,
} from "./material-list-part-search";
import { createMaterialListSummaries } from "./material-list-summary";
import { indexWorkspaceRecords } from "~/hooks/use-replicache-jobs";

it("matches names, supplier codes, punctuation and partial words without mixing separate parts", () => {
  const texts = [
    materialListPartSearchText({
      partDefinitionDisplayName: '2" XFR Wye',
      supplierPartSku: "WYE-200",
    }),
    materialListPartSearchText({ descriptionSnapshot: "6 inch copper elbow" }),
  ];
  for (const query of ["XFR wye", "wye-200", "2 xfr", "cop elb", ""])
    expect(matchesMaterialListPart(texts, query)).toBe(true);
  for (const query of ["copper wye", "12 xfr", "missing"])
    expect(matchesMaterialListPart(texts, query)).toBe(false);
});

it("provides matching search data in server summaries and local summaries, including legacy quote-only rows", () => {
  const part = {
    id: "item",
    quantity: "1",
    sentQuantity: null,
    receivedQuantity: null,
    sentOrderStatus: null,
    sentAt: null,
    verificationStatus: null,
    quoteId: "quote",
    materialListId: null,
    descriptionSnapshot: "Two inch cap",
    partDefinitionId: "cap",
    supplierId: null,
    sentOrderId: null,
    partDefinitionDisplayName: "2 inch Fernco cap",
    supplierPartSku: "2SWIFTCAP",
  };
  const list = { id: "list", jobId: "job", name: "Old list", quoteId: "quote" };
  const server = createMaterialListSummaries([part], [], new Map())(list);
  const local = indexWorkspaceRecords(
    [{ id: "job", name: "Job" }],
    [
      list,
      { id: "other", jobId: "job", name: "Other", quoteId: "other-quote" },
    ],
    [
      {
        ...part,
        partDefinition: { displayName: part.partDefinitionDisplayName },
        supplierPart: { supplierSku: part.supplierPartSku },
      },
    ],
  );
  const summary = local.details.job!.materialLists.find(
    (l) => l.id === "list",
  )!;
  expect(summary.partSearchTexts).toEqual(server.partSearchTexts);
  expect(matchesMaterialListPart(summary.partSearchTexts, "2SWIFTCAP")).toBe(
    true,
  );
  expect(
    matchesMaterialListPart(
      local.details.job!.materialLists.find((l) => l.id === "other")
        ?.partSearchTexts,
      "cap",
    ),
  ).toBe(false);
});
