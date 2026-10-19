import { describe, expect, it } from "vitest";
import { orderItemSequence } from "./order-item-sequence";
describe("order email sequence", () => {
  it("preserves displayed order inside each supplier and never includes client-only IDs", () => {
    const rows = [{id:"a",supplier:"one"},{id:"b",supplier:"two"},{id:"c",supplier:"one"}];
    const sorted = orderItemSequence(rows, ["c","b","foreign","a","c"], x=>x.id);
    expect(sorted.filter(x=>x.supplier==="one").map(x=>x.id)).toEqual(["c","a"]);
    expect(rows.map(x=>x.id)).toEqual(["a","b","c"]);
  });
  it("keeps missing and newly synced rows and preserves persisted order without a preference", () => {
    const rows=[{id:"a"},{id:"b"},{id:"c"}];
    expect(orderItemSequence(rows,["c"],x=>x.id).map(x=>x.id)).toEqual(["c","a","b"]);
    expect(orderItemSequence(rows,undefined,x=>x.id)).toEqual(rows);
  });
});
