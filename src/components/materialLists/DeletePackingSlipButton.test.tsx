import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { confirmAction } from "~/components/ui/app-dialogs";
import { DeletePackingSlipButton } from "./DeletePackingSlipButton";
vi.mock("~/components/ui/app-dialogs",()=>({confirmAction:vi.fn()}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();vi.clearAllMocks();});
const props={jobId:"job",documentId:"current",name:"Current slip"};
it("deletes only the current document after confirmation",async()=>{
 vi.mocked(confirmAction).mockResolvedValue(true);const request=vi.fn(async()=>Response.json({success:true}));vi.stubGlobal("fetch",request);const done=vi.fn();
 render(<DeletePackingSlipButton {...props} onDeleted={done}/>);fireEvent.click(screen.getByRole("button"));
 await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(request).toHaveBeenCalledWith("/api/job-documents?jobId=job",expect.objectContaining({method:"POST",body:JSON.stringify({jobId:"job",action:"delete",documentId:"current"})}));
 expect(confirmAction).toHaveBeenCalledWith(expect.objectContaining({description:expect.stringContaining("does not reverse a receipt")}));
});
it("cancel does not delete and server rejection keeps the review open",async()=>{
 vi.mocked(confirmAction).mockResolvedValueOnce(false).mockResolvedValueOnce(true);const request=vi.fn(async()=>Response.json({error:"Document is locked"},{status:409}));vi.stubGlobal("fetch",request);const done=vi.fn();
 render(<DeletePackingSlipButton {...props} onDeleted={done}/>);fireEvent.click(screen.getByRole("button"));await waitFor(()=>expect(screen.getByRole("button")).toBeEnabled());expect(request).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button"));expect(await screen.findByRole("alert")).toHaveTextContent("Document is locked");expect(done).not.toHaveBeenCalled();
});
