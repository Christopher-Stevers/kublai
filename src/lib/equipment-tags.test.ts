import { expect, it } from "vitest";
import { containsEquipmentTag, equipmentDrawingDestination, equipmentTagCandidates, equipmentTagLocations } from "./equipment-tags";
import { readSnapshotState } from "./snapshot-source";
const word={text:"HEX-2",left:0.2,top:0.3,right:0.25,bottom:0.32};
it("matches the full tag while tolerating spacing and dash variants",()=>{
 for(const text of ["HEX-2","HX HEX – 2 FOR EQUIPMENT","hex 2"] )expect(containsEquipmentTag(text,"HEX-2")).toBe(true);
 for(const text of ["HEX-20","HEX-2A","AHEX-2","HEX-21","HEX-2-1"] )expect(containsEquipmentTag(text,"HEX-2")).toBe(false);
 expect(containsEquipmentTag("HEX-2", "HEX2")).toBe(true);
});
it("reads only tags in the drawn hyperlink and leaves multiple candidates explicit",()=>{
 expect(equipmentTagCandidates([word,{...word,text:"FCU-1",left:0.8,right:0.9}],[{x:0.1,y:0.2},{x:0.3,y:0.4}])).toEqual(["HEX-2"]);
 expect(equipmentTagCandidates([word,{...word,text:"FCU-1",left:0.26,right:0.3}],[{x:0.1,y:0.2},{x:0.4,y:0.4}])).toEqual(["HEX-2","FCU-1"]);
});
it("joins text fragments for a tag and preserves their visual location",()=>{
 const words=[{...word,text:"HEX",right:0.23},{...word,text:"-",left:0.231,right:0.235},{...word,text:"2",left:0.236}];
 expect(equipmentTagLocations(words,"HEX-2")).toEqual([expect.objectContaining({left:0.2,right:0.25})]);
});
it("saves an internal drawing destination with zoom and page without a search highlight",()=>{
 const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
 const source=equipmentDrawingDestination({jobId:id,setId:id,sheetId:id,sourceSheetId:id,name:"M-101",tag:"HEX-2",box:word});
 const url=new URL(source.href,"https://example.test");
 expect(readSnapshotState(url.hash)?.drawing?.highlight).toBeUndefined();
 expect(url.searchParams.get("drawingSheet")).toBe(id);
 expect(readSnapshotState(url.hash)?.drawing).toMatchObject({sourceSheetId:id,search:"",viewport:{center:{x:0.225,y:0.31}}});
});
