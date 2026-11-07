import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SupplierPartEditor, type SupplierListing } from "./SupplierPartEditor";
const state = vi.hoisted(() => ({ save: vi.fn(), invalidate: vi.fn(), close: vi.fn() }));
vi.mock("~/trpc/react", () => ({ api: {
 useUtils: () => ({ supplier: { getById: { invalidate: state.invalidate }, getSupplierPartsByPart: { invalidate: state.invalidate } }, catalogue: { searchParts: { invalidate: state.invalidate } } }),
 catalogue: { getAllUnits: { useQuery: () => ({data: [{id:"unit",code:"box",displayName:"Box"}]}) } },
 supplier: { updateSupplierPart: { useMutation: () => ({ mutateAsync: state.save, isPending:false }) } },
} }));
vi.mock("~/components/ui/app-dialogs",()=>({notify:vi.fn()}));
const listing = { id:"listing", supplierId:"supplier", partDefinitionId:"part", supplierSku:"NEXT-1", supplierName:"Vendor description", packSize:"1", packUomId:"unit", packUom:{id:"unit",code:"box",displayName:"Box"}, lastKnownUnitCost:"30", currency:"CAD", notes:"", isPreferred:false, partDefinition:{id:"part",displayName:"Shared catalogue part",description:"Shared"},createdAt:new Date() } as SupplierListing;
beforeEach(()=>{vi.clearAllMocks();state.save.mockResolvedValue({});state.invalidate.mockResolvedValue(undefined);});
afterEach(cleanup);
function open(canEdit=true, showPrice=true, listings=[listing]) { return render(<SupplierPartEditor listings={listings} supplierName="Next" canEdit={canEdit} showPrice={showPrice} bulkUnit="box" onClose={state.close}/>); }
it("edits supplier fields and clears an unknown price without changing catalogue fields",async()=>{
 open();fireEvent.change(screen.getByLabelText("Supplier SKU"),{target:{value:"NEW-1"}});fireEvent.change(screen.getByLabelText("Supplier description"),{target:{value:"Updated description"}});fireEvent.change(screen.getByLabelText("Price per box"),{target:{value:""}});fireEvent.click(screen.getByRole("button",{name:"Save supplier information"}));
 await waitFor(()=>expect(state.close).toHaveBeenCalled());
 expect(state.save).toHaveBeenCalledWith({id:"listing",supplierSku:"NEW-1",supplierName:"Updated description",packSize:"1",packUomId:"unit",lastKnownUnitCost:null,currency:"CAD",notes:"",isPreferred:false});
 expect(state.invalidate).toHaveBeenCalledWith({id:"supplier"});
});
it("keeps the editor open and reports invalid quantities or a rejected save",async()=>{
 open();fireEvent.change(screen.getByLabelText("Minimum / order multiple"),{target:{value:"0"}});fireEvent.click(screen.getByRole("button",{name:"Save supplier information"}));
 expect(screen.getByRole("alert")).toHaveTextContent("positive order multiple");expect(state.save).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText("Minimum / order multiple"),{target:{value:"2"}});state.save.mockRejectedValue(new Error("SKU already used"));fireEvent.click(screen.getByRole("button",{name:"Save supplier information"}));
 await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("SKU already used"));expect(state.close).not.toHaveBeenCalled();
});
it("allows read-only inspection and hides financial fields without permission",()=>{
 open(false,false);expect(screen.getByLabelText("Supplier SKU")).toBeDisabled();expect(screen.queryByLabelText("Price per box")).toBeNull();expect(screen.queryByRole("button",{name:"Save supplier information"})).toBeNull();
});
it("can inspect and edit each supplier listing for the same catalogue part",async()=>{
 open(true,true,[listing,{...listing,id:"listing-2",supplierSku:"NEXT-2",supplierName:"Alternative"}]);
 fireEvent.change(screen.getByLabelText("Supplier listing"),{target:{value:"listing-2"}});
 expect(screen.getByLabelText("Supplier SKU")).toHaveValue("NEXT-2");fireEvent.click(screen.getByRole("button",{name:"Save supplier information"}));await waitFor(()=>expect(state.save).toHaveBeenCalledWith(expect.objectContaining({id:"listing-2",supplierSku:"NEXT-2"})));
});
