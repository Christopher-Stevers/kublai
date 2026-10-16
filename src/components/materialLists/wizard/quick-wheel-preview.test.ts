import { expect, it } from "vitest";
import { matchesPreviewSelection, nextWheelPreview, type PreviewSelection } from "./quick-wheel-preview";
const selection:PreviewSelection={catalogId:null,materialId:null,size:null,categoryId:null};
const data={catalogs:[{id:"plumbing",name:"Plumbing"},{id:"hardware",name:"Hardware"}],materials:[{id:"pex",name:"PEX"},{id:"cast",name:"Cast"}],categories:[{id:"wye",name:"Wyes"},{id:"ring",name:"Rings"}],parts:[
 {catalogId:"plumbing",materialId:"cast",sizeNominal:10,sizeUnit:"in",sizeLabel:"10 x 4",categoryId:"wye"},
 {catalogId:"plumbing",materialId:"cast",sizeNominal:10,sizeUnit:"in",sizeLabel:"10 x 6",categoryId:"wye"},
 {catalogId:"plumbing",materialId:"pex",sizeNominal:.5,sizeUnit:"in",sizeLabel:null,categoryId:"ring"},
]};
it("looks ahead using only the candidate's facets without changing current selections",()=>{
 const before=structuredClone(selection);
 expect(nextWheelPreview("catalog","Plumbing",selection,data)?.preview).toMatchObject({title:"Select Material",options:[{label:"All"},{label:"PEX"},{label:"Cast"}]});
 expect(nextWheelPreview("material","Cast",{...selection,catalogId:"plumbing"},data)?.preview.options).toEqual([{label:"All"},{label:'10" x 4"'},{label:'10" x 6"'}]);
 expect(selection).toEqual(before);
});
it("preserves exact reducing sizes, broad nominal families and the final parts boundary",()=>{
 const next=nextWheelPreview("size",'10" x 4"',{...selection,catalogId:"plumbing",materialId:"cast"},data)!;
 expect(next.preview).toMatchObject({title:"Select Category",options:[{label:"All"},{label:"Wyes"}]});
 expect(next.selection.size).toEqual({nominal:10,unit:"in",sizeLabel:"10 x 4"});
 expect(data.parts.filter(part=>matchesPreviewSelection(part,next.selection))).toHaveLength(1);
 expect(data.parts.filter(part=>matchesPreviewSelection(part,{...next.selection,size:{nominal:10,unit:"in"}}))).toHaveLength(2);
 expect(nextWheelPreview("category","Wyes",next.selection,data)?.preview).toEqual({title:"Parts",kind:"parts",options:[]});
});
it("mirrors empty-step skips, All and unknown choices",()=>{
 const uncategorized={...data,materials:[],categories:[],parts:[{...data.parts[0]!,materialId:null,sizeNominal:null,sizeUnit:null,categoryId:null}]};
 expect(nextWheelPreview("catalog","All",selection,uncategorized)?.preview.kind).toBe("parts");
 expect(nextWheelPreview("catalog","Prefabs",selection,data)).toBeUndefined();
 expect(nextWheelPreview("part","Anything",selection,data)).toBeUndefined();
});
