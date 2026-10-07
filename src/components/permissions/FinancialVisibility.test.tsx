import { cleanup, render, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FinancialOnly, FinancialVisibilityProvider } from "./FinancialVisibility";
const role = vi.hoisted(() => ({ visible: undefined as boolean | undefined }));
vi.mock("~/trpc/react", () => ({ api: { user: { getMyRole: { useQuery: () => ({
  data: role.visible === undefined ? undefined : { permissions: { can: { "financial.view": role.visible } } },
}) } } } }));
afterEach(() => { cleanup(); role.visible = undefined; });
function Fields() {
  return <><span>8 parts</span><FinancialOnly><span>$91.20</span></FinancialOnly>
    {createPortal(<FinancialOnly><label>Unit cost<input value="11.40" readOnly /></label></FinancialOnly>, document.body)}</>;
}
describe("financial UI", () => {
  it("has no amount or cost input flash while a hidden account loads; portals obey the permission", () => {
    render(<FinancialVisibilityProvider initialVisible={false}><Fields /></FinancialVisibilityProvider>);
    expect(screen.getByText("8 parts")).toBeTruthy();
    expect(screen.queryByText("$91.20")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("responds to refreshed permissions without hiding quantities", () => {
    role.visible = true;
    const { rerender } = render(<FinancialVisibilityProvider initialVisible><Fields /></FinancialVisibilityProvider>);
    expect(screen.getByText("$91.20")).toBeTruthy();
    role.visible = false;
    rerender(<FinancialVisibilityProvider initialVisible><Fields /></FinancialVisibilityProvider>);
    expect(screen.queryByText("$91.20")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText("8 parts")).toBeTruthy();
  });
});
