import { expect, it } from "vitest";
import { equipmentDocumentDestination, legacyEquipmentDocumentLink } from "./equipment-tags";
import { readSnapshotState } from "./snapshot-source";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
it("keeps page, version and focus within the existing PDF snapshot contract",()=>{
 const link=equipmentDocumentDestination({jobId:id(1),documentId:id(2),versionId:id(3),name:"Submittal",tag:"HEX-2",page:9,box:{text:"HEX-2",left:.4,right:.5,top:.7,bottom:.72}});
 const state=readSnapshotState(new URL(link.href,"https://example.com").hash);
 expect(state?.pdf?.page).toBe(9);
 expect(state?.pdf?.viewport?.center.x).toBe(.45);
 expect(state?.document?.versionId).toBe(id(3));
 expect(legacyEquipmentDocumentLink({label:"HEX-2 — Submittal",url:link.href},id(1))).toBeNull();
});
it("recognizes only older internal equipment document links",()=>{
 const url=`/dashboard/jobs/${id(1)}/documents?document=${id(2)}`;
 expect(legacyEquipmentDocumentLink({label:"HEX-2 — Submittal",url},id(1))).toEqual({tag:"HEX-2",documentId:id(2)});
 expect(legacyEquipmentDocumentLink({label:"Manual",url},id(1))).toBeNull();
 expect(legacyEquipmentDocumentLink({label:"HEX-2 — Submittal",url:"https://foreign.example"+url},id(1))).toBeNull();
});
