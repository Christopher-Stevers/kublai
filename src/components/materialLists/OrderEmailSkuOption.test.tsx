import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
const preference=vi.hoisted(()=>({includeSupplierSku:false,disabled:false,set:vi.fn()}));
vi.mock("~/hooks/use-supplier-email-preference",()=>({useSupplierEmailPreference:()=>preference}));
import { OrderEmailSkuOption } from "./OrderEmailSkuOption";
function Preview(){const [body,setBody]=useState("Hello,\n2 - Clip\nMy delivery note.");return <><OrderEmailSkuOption supplierId="supplier" body={body} lines={[{plain:"2 - Clip",withSku:"2 - Clip [SKU: ABC]"}]} onChange={setBody}/><pre>{body}</pre></>;}
afterEach(()=>{cleanup();preference.includeSupplierSku=false;vi.clearAllMocks();});
it("starts off, previews and remembers the choice, preserving the message",()=>{
 render(<Preview/>);const toggle=screen.getByRole("checkbox",{name:"Include supplier SKU"});expect(toggle).not.toBeChecked();fireEvent.click(toggle);expect(preference.set).toHaveBeenCalledWith(true);expect(screen.getByText(/Hello,/)).toHaveTextContent("2 - Clip [SKU: ABC]");expect(screen.getByText(/Hello,/)).toHaveTextContent("My delivery note.");
});
it("applies an already saved supplier preference to the preview",()=>{
 preference.includeSupplierSku=true;render(<Preview/>);expect(screen.getByRole("checkbox",{name:"Include supplier SKU"})).toBeChecked();expect(screen.getByText(/Hello,/)).toHaveTextContent("[SKU: ABC]");
});
