import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CatalogueScreen } from "./CatalogueScreen";
const state=vi.hoisted(()=>({wizard:vi.fn(),invalid:vi.fn()}));
vi.mock("~/lib/snapshot-source",()=>({currentSnapshotState:()=>null}));
vi.mock("~/hooks/use-online-status",()=>({useOnlineStatus:()=>true}));
vi.mock("~/trpc/react",()=>({api:{
 useUtils:()=>({}),user:{getMyRole:{useQuery:()=>({data:{permissions:{canEditParts:true,can:{"financial.view":true}}}})}},
 supplier:{list:{useQuery:()=>({data:[{id:"one",name:"Next"},{id:"two",name:"Fastening House"}]})},getById:{useQuery:({id}:{id:string})=>({isPending:false,data:{id,name:id==="one"?"Next":"Fastening House",supplierParts:[{id:`listing-${id}`,supplierId:id,partDefinitionId:`part-${id}`,supplierSku:`SKU-${id}`,supplierName:`Description ${id}`,packSize:"1",lastKnownUnitCost:"25",currency:"CAD",packUom:null}]}})}},
 catalogue:{recentOrderWheelUsage:{useQuery:()=>({})},importCatalogueRows:{useMutation:()=>({})}},
}}));
vi.mock("~/components/materialLists/wizard/use-part-wizard",()=>({usePartWizard:(_open:unknown,_sort:unknown,_kw:unknown,_kind:unknown,supplierId?:string)=>{
 state.wizard(supplierId);
 return{wizardStage:"part",wizardSearchQuery:"",hasCatalogSelection:true,hasMaterialSelection:true,hasSizeSelection:true,hasCategorySelection:true,allUnits:[],catalogs:[],filteredPartsForSelection:[{id:`part-${supplierId??"all"}`,displayName:"Core description"}]};
}}));
vi.mock("~/components/materialLists/WizardHeader",()=>({WizardHeader:()=>null}));
vi.mock("./SupplierPartEditor",()=>({SupplierPartDetails:({listing}:{listing:{supplierSku:string}})=><span>{listing.supplierSku}</span>,SupplierPartEditor:({listings,onClose}:{listings:{id:string}[];onClose:()=>void})=><div role="dialog">Editing {listings[0]?.id}<button onClick={onClose}>Close supplier editor</button></div>}));
vi.mock("~/components/app/DeferredFeatures",()=>({
 EditPartDialog:({open}:{open:boolean})=>open?<div role="dialog">Core part editor</div>:null,CreateCustomPartDialog:()=>null,MaterialGroupsDialog:()=>null,PhotoQueueDialog:()=>null,AddPartDialog:()=>null,
 PartStage:({partsForSelection,detailsByPartId,onEditPart}:{partsForSelection:{id:string}[];detailsByPartId?:Record<string,React.ReactNode>;onEditPart:(id:string)=>void})=><div>{partsForSelection.map(part=><div key={part.id}>{detailsByPartId?.[part.id]}<button onClick={()=>onEditPart(part.id)}>Open {part.id}</button></div>)}</div>,
}));
afterEach(()=>{cleanup();vi.clearAllMocks();});
it("switches supplier scope and opens that supplier's editor, with the normal catalogue still available",async()=>{
 render(<CatalogueScreen/>);
 fireEvent.change(screen.getByLabelText("Catalogue mode"),{target:{value:"supplier"}});
 expect(screen.getByText(/Choose a supplier to browse/)).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText("Catalogue supplier"),{target:{value:"one"}});
 expect(screen.getByText("SKU-one")).toBeInTheDocument();fireEvent.click(screen.getByRole("button",{name:"Open part-one"}));
 expect(screen.getByRole("dialog")).toHaveTextContent("Editing listing-one");
 fireEvent.click(screen.getByRole("button",{name:"Close supplier editor"}));
 fireEvent.change(screen.getByLabelText("Catalogue supplier"),{target:{value:"two"}});
 expect(screen.queryByText("SKU-one")).toBeNull();expect(screen.getByText("SKU-two")).toBeInTheDocument();
 expect(state.wizard).toHaveBeenLastCalledWith("two");
 fireEvent.change(screen.getByLabelText("Catalogue mode"),{target:{value:"all"}});
 fireEvent.click(screen.getByRole("button",{name:"Open part-all"}));
 await waitFor(()=>expect(screen.getByRole("dialog")).toHaveTextContent("Core part editor"));
});
