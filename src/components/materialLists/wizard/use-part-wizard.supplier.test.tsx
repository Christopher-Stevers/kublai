import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePartWizard } from "./use-part-wizard";
const fixtures = vi.hoisted(() => {
 const part={id:"part",displayName:"Shared clip",description:null,imageUrl:null,material:"PEX",materialId:"material",size:"1/2 in",sizeLabel:null,sizeNominal:"0.5",sizeUnit:"in",catalogId:"catalog",categoryId:"category",isOrgSpecific:true};
 const metadata={catalogs:[{id:"catalog",name:"Plumbing",kind:"materials",sortOrder:0}],materials:[{id:"material",name:"PEX"}],categories:[{id:"category",name:"Clamps",sortOrder:0}],allUnits:[]};
 return { part, summary:{...metadata,parts:[{...part,count:1}]}, cache:{...metadata,parts:[{...part,id:"wrong-supplier",displayName:"Cached outsider"}]}, summaryQuery:vi.fn(), searchQuery:vi.fn() };
});
vi.mock("~/hooks/use-online-status",()=>({useOnlineStatus:()=>true}));
vi.mock("~/components/tutorial/tutorial-sandbox-context",()=>({useTutorialSandbox:()=>false}));
vi.mock("~/hooks/use-replicache-catalogue",()=>({useReplicacheCatalogue:()=>fixtures.cache}));
vi.mock("~/lib/replicache-catalogue",()=>({requestCatalogueReplicachePull:vi.fn()}));
vi.mock("~/lib/snapshot-source",()=>({currentSnapshotState:()=>null}));
vi.mock("~/components/chat/SnapshotSourceContext",()=>({useSnapshotSource:vi.fn()}));
vi.mock("~/trpc/react",()=>({api:{
 useUtils:()=>({}),
 catalogue:{
  getPartWizardSummary:{useQuery:(input:unknown,options:unknown)=>{fixtures.summaryQuery(input,options);return{data:fixtures.summary,isPending:false,error:null};}},
  searchParts:{useQuery:(input:unknown,options:unknown)=>{fixtures.searchQuery(input,options);return{data:[fixtures.part],isPending:false,error:null};}},
  createCatalog:{useMutation:()=>({})},createMaterial:{useMutation:()=>({})},createSize:{useMutation:()=>({})},createCategoryType:{useMutation:()=>({})},
 },
}}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("uses supplier-scoped facets and search even when the complete offline catalogue is warm",async()=>{
 const {result}=renderHook(()=>usePartWizard(true,undefined,undefined,"materials","supplier"));
 await waitFor(()=>expect(fixtures.summaryQuery).toHaveBeenCalledWith({grouped:true,supplierId:"supplier"},expect.objectContaining({enabled:true})));
 expect(result.current.catalogsWithCounts[0]?.count).toBe(1);
 act(()=>result.current.handleCatalogSelect("catalog"));act(()=>result.current.handleMaterialSelect("material"));
 expect(result.current.filteredAvailableSizes[0]?.count).toBe(1);
 act(()=>result.current.handleSizeSelect({nominal:.5,unit:"in"}));act(()=>result.current.handleCategorySelection({categoryId:"category",name:"Clamps"}));
 act(()=>result.current.setWizardSearchQuery("NX-CLIP"));
 await waitFor(()=>expect(fixtures.searchQuery).toHaveBeenCalledWith(expect.objectContaining({supplierId:"supplier",query:"NX-CLIP"}),expect.objectContaining({enabled:true})));
 expect(result.current.filteredPartsForSelection.map(p=>p.id)).toEqual(["part"]);
});
it("retains the regular cached catalogue outside supplier mode",()=>{
 const {result}=renderHook(()=>usePartWizard());
 act(()=>result.current.handleCatalogSelect("catalog"));act(()=>result.current.handleMaterialSelect("material"));act(()=>result.current.handleSizeSelect(null));act(()=>result.current.handleCategorySelection({categoryId:"category",name:"Clamps"}));
 expect(result.current.filteredPartsForSelection.map(p=>p.id)).toEqual(["wrong-supplier"]);
});
