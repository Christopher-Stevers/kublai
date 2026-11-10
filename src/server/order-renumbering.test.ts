// @vitest-environment node
import { describe, expect, it } from "vitest";
import { planOrderRenumbering, renumberDocumentLinks } from "./order-renumbering";
import { emptyDocumentState } from "./documents/domain";
import type { JobDocument, DocumentVersion } from "./documents/types";

describe("order renumbering", () => {
  it("numbers every job independently, oldest first, with stable imported ties", () => {
    const row = (id: string, jobId: string, orderNumber: string, createdAt = "2026-01-01") => ({id, jobId, orderNumber, createdAt, supplierName:"Next"});
    const plan = planOrderRenumbering([row("z","a","2-Next"),row("a","a","1-Next"),row("b","a","7870155-00","2026-11-01"),row("c","b","45-Next")]);
    expect(plan.map(p => [p.id,p.after])).toEqual([["a","1-Next"],["z","2-Next"],["b","3-Next"],["c","1-Next"]]);
    expect(planOrderRenumbering(plan.map(p => row(p.id,p.jobId,p.after,p.id === "b" ? "2026-11-01" : "2026-01-01")))).toEqual(plan.map(p => ({...p,before:p.after})));
  });
  it("renames linked documents through swaps without altering receipts or historical files", () => {
    const state = emptyDocumentState();
    for (const [id, number] of [["a","2-Next"],["b","1-Next"]]) {
      state.documents.push({id, jobId:"job",folderId:"folder",name:`Packing slip - ${number}.pdf`,description:`Packing slip for ${number} · List`,currentVersionId:id,deletedAt:null,
        packingSlip:{orderId:id!,orderNumber:number!,materialListId:"list",materialListName:"List"},
        receivingReview:{lines:[{approved:true,quantity:3}]} } as unknown as JobDocument);
      state.versions.push({id,documentId:id,name:`Packing slip - ${number}.pdf`,mimeType:"application/pdf",sha256:"same-file"} as DocumentVersion);
    }
    state.versions.push({id:"historical",documentId:"a",name:"original.pdf",mimeType:"application/pdf",sha256:"old-file"} as DocumentVersion);
    const receipts = structuredClone(state.documents.map(d => d.receivingReview));
    const plan = [{id:"a",jobId:"job",before:"2-Next",after:"1-Next"},{id:"b",jobId:"job",before:"1-Next",after:"2-Next"}];
    expect(renumberDocumentLinks(state,plan,"now")).toBe(2);
    expect(state.documents.map(d => d.name)).toEqual(["Packing slip - 1-Next.pdf","Packing slip - 2-Next.pdf"]);
    expect(state.documents.map(d => d.receivingReview)).toEqual(receipts);
    expect(state.versions[2]!.name).toBe("original.pdf");
    expect(state.versions.map(v => v.sha256)).toEqual(["same-file","same-file","old-file"]);
    expect(renumberDocumentLinks(state,plan,"later")).toBe(0);
  });
});
