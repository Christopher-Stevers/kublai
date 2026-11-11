import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FeatureErrorBoundary } from "./FeatureErrorBoundary";
function Broken(): never { throw new Error("Synthetic panel error"); }
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it("keeps the ordinary reload option by default",()=>{
  vi.spyOn(console,"error").mockImplementation(()=>undefined);
  render(<FeatureErrorBoundary onRetry={()=>undefined}><Broken/></FeatureErrorBoundary>);
  expect(screen.getByRole("button",{name:"Reload app"})).toBeVisible();
});
it("can retry private panel content without a reload affordance or parent draft reset",()=>{
  vi.spyOn(console,"error").mockImplementation(()=>undefined);
  function Draft(){const[failed,setFailed]=useState(true);return <><input aria-label="Draft" defaultValue=""/><FeatureErrorBoundary allowReload={false} onRetry={()=>setFailed(false)}>{failed?<Broken/>:<p>Panel ready</p>}</FeatureErrorBoundary></>;}
  render(<Draft/>);
  const input=screen.getByLabelText("Draft");fireEvent.change(input,{target:{value:"Keep this draft"}});
  expect(screen.queryByRole("button",{name:"Reload app"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Try again"}));
  expect(screen.getByText("Panel ready")).toBeVisible();
  expect(screen.getByLabelText("Draft")).toBe(input);expect(input).toHaveValue("Keep this draft");
});
