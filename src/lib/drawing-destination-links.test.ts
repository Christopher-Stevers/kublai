import { expect, it } from "vitest";
import { drawingDestinationLinks } from "./drawing-links";
import { equipmentDrawingDestination } from "./equipment-tags";
import { drawingMarkupSchema } from "./drawing-workspace";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const link=(sheetId:string,left:number,sourceSheetId=sheetId)=>({label:`Tag ${left}`,url:equipmentDrawingDestination({jobId:id(1),setId:id(2),sheetId,sourceSheetId,name:"M-604",tag:"HEX-2",box:{text:"HEX-2",left,right:left+.02,top:.3,bottom:.32}}).href});
it("excludes the current tag but keeps another occurrence on the same drawing, other drawings and documents",()=>{
 const self=link(id(3),.2),other=link(id(3),.6),page=link(id(4),.2),revision=link(id(3),.2,id(5)),doc={label:"Manual",url:"/dashboard/jobs/documents"};
 const markup=drawingMarkupSchema.parse({type:"link",equipmentTag:"HEX-2",sourceSheetId:id(3),points:[{x:.2,y:.3},{x:.22,y:.32}],links:[self,other,page,revision,doc]});
 expect(drawingDestinationLinks(markup,id(3))).toEqual([other,page,revision,doc]);
 expect(markup.links).toHaveLength(5);
});
it("keeps ordinary hyperlinks without equipment-tag context",()=>{
 const self=link(id(3),.2);
 const markup=drawingMarkupSchema.parse({type:"link",sourceSheetId:id(3),points:[{x:.2,y:.3},{x:.22,y:.32}],links:[self]});
 expect(drawingDestinationLinks(markup,id(3))).toEqual([self]);
});
