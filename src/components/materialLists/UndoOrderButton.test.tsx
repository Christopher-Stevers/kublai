import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({confirm:vi.fn(),undo:vi.fn(),invalidate:vi.fn(),sync:vi.fn(),notify:vi.fn()}));
vi.mock("~/trpc/react",()=>({api:{useUtils:()=>({materialList:{listOrders:{invalidate:state.invalidate},previewOrders:{invalidate:state.invalidate},getOrdersForMaterialList:{invalidate:state.invalidate}},job:{getJob:{invalidate:state.invalidate}}}),materialList:{undoOrder:{useMutation:()=>({isPending:false,mutateAsync:state.undo})}}}}));
vi.mock("~/components/ui/app-dialogs",()=>({confirmAction:state.confirm,notify:state.notify}));
vi.mock("~/lib/replicache-material-list",()=>({requestMaterialListReplicacheSync:state.sync}));
import { UndoOrderButton } from "./UndoOrderButton";
beforeEach(()=>{vi.clearAllMocks();state.confirm.mockResolvedValue(true);state.undo.mockResolvedValue({materialListId:"list"});});
afterEach(cleanup);
it("explains the full reset and refreshes only after undo succeeds",async()=>{
 render(<UndoOrderButton orderId="order" />);
 fireEvent.click(screen.getByRole("button",{name:"Undo order"}));
 await waitFor(()=>expect(state.sync).toHaveBeenCalled());
 expect(state.undo).toHaveBeenCalledWith({orderId:"order"});
 expect(state.confirm.mock.calls[0]![0].description).toContain("all of its delivery records");
 expect(state.invalidate).toHaveBeenCalledTimes(4);
});
it("leaves the order unchanged when the confirmation is cancelled",async()=>{
 state.confirm.mockResolvedValue(false);
 render(<UndoOrderButton orderId="order" />);
 fireEvent.click(screen.getByRole("button",{name:"Undo order"}));
 await waitFor(()=>expect(state.confirm).toHaveBeenCalled());
 expect(state.undo).not.toHaveBeenCalled();
});
