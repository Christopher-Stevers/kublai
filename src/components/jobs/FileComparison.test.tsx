import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FileComparison } from "./FileComparison";
vi.mock("./documents/PassiveDocumentPdfPreview", () => ({PassiveDocumentPdfPreview: ({url,title}:{url:string;title:string}) => <div data-testid="pdf" data-url={url}>{title}</div>}));
vi.mock("./DrawingSheetViewer", () => ({DrawingSheetViewer: ({alt}:{alt:string}) => <div>{alt}</div>}));
afterEach(() => {cleanup();vi.unstubAllGlobals();});
const docs = {documents:[{id:"one",name:"Current slip",currentVersionId:"v1"},{id:"two",name:"Earlier slip",currentVersionId:"v2"},{id:"deleted",name:"Deleted",deletedAt:"yesterday",currentVersionId:"v3"}],versions:[{id:"v1",mimeType:"application/pdf"},{id:"v2",mimeType:"application/pdf"},{id:"v3",mimeType:"application/pdf"}]};
it("opens the two duplicate documents without changing receiving data", async () => {
 const request=vi.fn(async(_url: string)=>new Response(JSON.stringify(docs)));vi.stubGlobal("fetch",request);
 render(<FileComparison jobId="job" initialDocumentIds={["one","two"]} onClose={()=>{}} />);
 const panes=await screen.findAllByTestId("pdf");expect(panes.map(p=>p.getAttribute("data-url"))).toEqual(["/api/job-documents/files/v1?jobId=job","/api/job-documents/files/v2?jobId=job"]);
 expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0]?.[0]).toBe("/api/job-documents?jobId=job");
 expect(screen.queryByRole("option",{name:"Deleted"})).not.toBeInTheDocument();
});
it("pages each drawing set independently and allows switching one to a PDF", async () => {
 vi.stubGlobal("fetch",vi.fn(async(_url: string)=>new Response(JSON.stringify(docs))));
 const sheets=[{id:"a1",name:"A1",setId:"a",setName:"Mechanical",imageUrl:"/a1.png"},{id:"a2",name:"A2",setId:"a",setName:"Mechanical",imageUrl:"/a2.png"},{id:"b1",name:"B1",setId:"b",setName:"Plumbing",imageUrl:"/b1.png"}];
 render(<FileComparison jobId="job" sheets={sheets} initialSheetId="a1" onClose={()=>{}} />);
 await screen.findAllByRole("option",{name:"Earlier slip"});
 fireEvent.change(screen.getByLabelText("Right file"),{target:{value:"set:b"}});
 fireEvent.click(screen.getByRole("button",{name:"Left next sheet"}));
 expect(within(screen.getByRole("region",{name:"Left comparison"})).getByText("A2")).toBeVisible();
 expect(within(screen.getByRole("region",{name:"Right comparison"})).getByText("B1")).toBeVisible();
 fireEvent.change(screen.getByLabelText("Right file"),{target:{value:"document:two"}});
 expect(screen.getByTestId("pdf")).toHaveTextContent("Earlier slip");expect(screen.getByText("A2")).toBeVisible();
});
it("keeps an unavailable duplicate explicit and supports retry", async()=>{
 const request=vi.fn().mockResolvedValueOnce(new Response("error",{status:500})).mockResolvedValueOnce(new Response(JSON.stringify(docs)));vi.stubGlobal("fetch",request);
 render(<FileComparison jobId="job" initialDocumentIds={["one","missing"]} onClose={()=>{}} />);
 expect(await screen.findByRole("alert")).toHaveTextContent("Could not load");
 fireEvent.click(screen.getByRole("button",{name:"Retry"}));await screen.findByTestId("pdf");
 expect(screen.getByText("This file is unavailable. Choose another file.")).toBeVisible();
});
it("fills the drawing area inline instead of opening a separate window", async () => {
 vi.stubGlobal("fetch",vi.fn(async(_url: string)=>new Response(JSON.stringify(docs))));
 const onClose=vi.fn(),onOverlay=vi.fn();
 const sheets=[{id:"a1",name:"A1",setId:"a",setName:"Mechanical",imageUrl:"/a1.png"}];
 render(<FileComparison inline jobId="job" sheets={sheets} initialSheetId="a1" onClose={onClose} onOverlay={onOverlay} />);
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
 const region=screen.getByRole("region",{name:"Compare files"});
 expect(within(region).getByRole("region",{name:"Left comparison"})).toHaveTextContent("A1");
 expect(within(region).getByRole("region",{name:"Right comparison"})).toBeVisible();
 await screen.findAllByRole("option",{name:"Earlier slip"});
 fireEvent.click(screen.getByRole("button",{name:"Overlay"}));expect(onOverlay).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByRole("button",{name:"Close comparison"}));expect(onClose).toHaveBeenCalledOnce();
});
