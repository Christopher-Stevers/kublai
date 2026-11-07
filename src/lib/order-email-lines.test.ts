import { expect, it } from "vitest";
import { formatEmailItemLine, supplierSkuLines, setEmailSupplierSkus } from "./order-email-lines";
const item={quantity:"2",descriptionSnapshot:'1/2" pipe clip',supplierSku:"NEXT123"};
it("omits SKUs by default and includes them only when requested",()=>{
 expect(formatEmailItemLine(item)).toBe('2 - 1/2" pipe clip');
 expect(formatEmailItemLine(item,true)).toBe('2 - 1/2" pipe clip [SKU: NEXT123]');
 expect(formatEmailItemLine({...item,supplierSku:null,supplierSkuSnapshot:"OLD1"},true)).toContain('[SKU: OLD1]');
});
it("toggles generated lines without losing edits and remains idempotent",()=>{
 const body=`Hello changed name,\n${formatEmailItemLine(item)}\nNotes:\nPlease call me first.`;
 const lines=supplierSkuLines([item]);
 const included=setEmailSupplierSkus(body,lines,true);
 expect(included).toContain('[SKU: NEXT123]');expect(included).toContain('Hello changed name,');expect(included).toContain('Please call me first.');
 expect(setEmailSupplierSkus(included,lines,true)).toBe(included);
 expect(setEmailSupplierSkus(included,lines,false)).toBe(body);
});
it("handles repeated item descriptions with distinct SKUs in order",()=>{
 const items=[item,{...item,supplierSku:"NEXT456"}];
 const body=items.map(value=>formatEmailItemLine(value)).join('\n');
 const included=setEmailSupplierSkus(body,supplierSkuLines(items),true);
 expect(included.split('\n')).toEqual(items.map(value=>formatEmailItemLine(value,true)));
});
