// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const mock=vi.hoisted(()=>({workspace:vi.fn(),documentAccess:vi.fn(),overview:vi.fn(),index:vi.fn()}));
vi.mock("./service",()=>({getDrawingWorkspace:mock.workspace}));
vi.mock("~/server/documents/access",()=>({assertDocumentAccess:mock.documentAccess}));
vi.mock("~/server/documents/service",()=>({documentOverview:mock.overview}));
vi.mock("~/server/documents/storage",()=>({documentBlobPath:()=>"/private/test.pdf"}));
vi.mock("./equipment-index",()=>({equipmentIndex:mock.index,drawingPdfLocation:()=>({file:"/private/plan.pdf",page:1})}));
import { equipmentMatches } from "./equipment-links";
import type { DrawingContext } from "./service";
const ctx={userId:"user",db:{}} as DrawingContext;
const a={id:"a",setId:"set",name:"A",imageUrl:"a"},b={id:"b",setId:"set",name:"B",imageUrl:"b"};
beforeEach(()=>{
 vi.clearAllMocks();
 mock.workspace.mockResolvedValue({jobId:"job",jobSheets:[a,b,{...b,id:"foreign",setId:"other"}],metadata:{currentSourceSheetId:"b"}});
 mock.documentAccess.mockResolvedValue({job:{organizationId:"org"}});
 mock.overview.mockResolvedValue({documents:[],versions:[]});
 mock.index.mockResolvedValue({pages:[{page:1,words:[]}],incomplete:false});
});
it("refuses a page in another drawing set",async()=>{
 await expect(equipmentMatches(ctx,{sheetId:"a",tag:"HEX-2",source:{kind:"drawing",id:"foreign",name:"Fake"}})).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(mock.index).not.toHaveBeenCalled();
});
it("does not inspect private or deleted documents excluded by document access",async()=>{
 await expect(equipmentMatches(ctx,{sheetId:"a",tag:"HEX-2",source:{kind:"document",id:"hidden",name:"Fake"}})).rejects.toMatchObject({code:"NOT_FOUND"});
 expect(mock.index).not.toHaveBeenCalled();
});
it("keeps metadata matches even when contents cannot be indexed and reports the gap",async()=>{
 mock.overview.mockResolvedValue({documents:[{id:"doc",name:"HEX-2 datasheet",description:"",tags:[],currentVersionId:"version"}],versions:[{id:"version",name:"data.pdf",mimeType:"application/pdf",sha256:"hash"}]});
 mock.index.mockRejectedValue(Error("timeout"));
 const result=await equipmentMatches(ctx,{sheetId:"a",tag:"HEX-2",source:{kind:"document",id:"doc",name:"Fake"}});
 expect(result.links).toHaveLength(1);expect(result.links[0]!.label).toBe("HEX-2 — HEX-2 datasheet");expect(result.warnings).toHaveLength(1);
});
