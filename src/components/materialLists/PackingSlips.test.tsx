import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PackingSlips } from "./PackingSlips";
vi.mock("~/components/ui/app-dialogs", () => ({ confirmAction: vi.fn(async () => true) }));
vi.mock("~/hooks/use-online-status", () => ({ useOnlineStatus: () => true }));
const routerPush = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: routerPush, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }) }));
vi.mock("next/dynamic", async () => {
  const { useState } = await import("react");
  return {
    default: () => function Scanner({ onCancel, onSave }: { onCancel: () => void; onSave: (file: File) => Promise<boolean> }) {
      const [saved, setSaved] = useState(false);
      const [failed, setFailed] = useState(false);
      const [file] = useState(() => new File(["scan"], "Packing slip.pdf", { type: "application/pdf" }));
      return <section aria-label="Packing slip camera">
        {failed && <p role="alert">PDF was not saved. Tap Done to retry.</p>}
        {saved ? <><p>PDF saved</p><button onClick={onCancel}>Close scan</button></> : <>
          <button onClick={async () => { const ok = await onSave(file); setSaved(ok); setFailed(!ok); }}>Done</button>
          <button onClick={onCancel}>Cancel scan</button>
        </>}
      </section>;
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("saves a scan with its order and returns to the slip list to watch it being read", async () => {
  let saved = false;
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      expect(url).toBe("/api/job-documents/upload?jobId=job");
      expect((options.body as FormData).get("packingSlipOrderId")).toBe(
        "order",
      );
      expect((options.body as FormData).get("file")).toBeInstanceOf(File);
      saved = true;
      return Response.json({ success: true });
    }
    return Response.json({
      canUpload: true,
      documents: saved
        ? [
            {
              id: "doc",
              name: "Packing slip - PO-123.jpg",
              createdAt: "2026-10-17",
              currentVersionId: "version",
              packingSlip: {
                orderId: "order",
                materialListId: "list",
                orderNumber: "PO-123",
              },
              packingSlipAnalysis: {
                runId: "run",
                versionId: "version",
                status: "processing",
                startedAt: new Date().toISOString(),
                items: [],
                lines: [],
                warnings: [],
              },
            },
          ]
        : [],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText(/Reading the packing slip/);
  expect(screen.getByText("Reading…")).toBeInTheDocument();
  expect(screen.getByText(/It's being read now/)).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Packing slip camera" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(
    fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});
it("closes after saving a scan and opens the slip in receiving", async () => {
  routerPush.mockClear();
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(options?.method === "POST" ? { success: true, documentId: "doc" } : { canUpload: true, documents: [] })));
  const changed = vi.fn();
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" onChanged={changed} onReviewOnList={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(changed).toHaveBeenCalledTimes(1);
  expect(routerPush).toHaveBeenCalledWith("/jobs/job/receiving?document=doc");
});
it("retains a failed scan for retry and offers read-only slips from a normal material list", async () => {
  let fail = true;
  const fetcher = vi.fn(async (_: string, options?: RequestInit) =>
    options?.method === "POST"
      ? Response.json(
          fail ? { error: "Storage unavailable" } : { success: true },
          { status: fail ? 500 : 200 },
        )
      : Response.json({ canUpload: true, documents: [] }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <PackingSlips jobId="job" materialListId="list" orderId="order" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByRole("alert");
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  await screen.findByText(/It's being read now/);
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(([, options]) => options?.method === "POST"),
    ).toHaveLength(2),
  );
  view.unmount();
  render(<PackingSlips jobId="job" materialListId="list" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByText(/Open Verify Order/);
  expect(
    screen.queryByRole("button", { name: "Take photo" }),
  ).not.toBeInTheDocument();
});

it("opens the scanner directly for an order without requiring Take photo", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ canUpload: true, documents: [] })));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
  expect(screen.queryByRole("button", { name: "Take photo" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Scan packing slip" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
  await screen.findByRole("button", { name: "Take photo" });
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
});
it("does not open the camera before upload permission is confirmed", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ canUpload: false, documents: [] })));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByText("No packing slips attached yet.");
  expect(screen.queryByRole("region", { name: "Packing slip camera" })).not.toBeInTheDocument();
});
it("shows the slip list with Upload instead of the scanner on a computer without a camera", async () => {
  vi.stubGlobal("navigator", {
    ...navigator,
    mediaDevices: { enumerateDevices: async () => [{ kind: "audioinput" }] },
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ canUpload: true, documents: [] })));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByRole("button", { name: "Upload" });
  expect(screen.queryByRole("region", { name: "Packing slip camera" })).not.toBeInTheDocument();
});

it("opens a saved slip's summary instead of restarting the camera, and sends it to receiving", async () => {
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    canUpload: true,
    documents: [{
      id: "doc", name: "Packing slip - PO-123.pdf", createdAt: "2026-10-17",
      currentVersionId: "version",
      packingSlip: { orderId: "order", materialListId: "list", orderNumber: "PO-123" },
      packingSlipAnalysis: { runId: "run", versionId: "version", status: "ready",
        startedAt: new Date().toISOString(), items: [], lines: [], warnings: [] },
    }],
  })));
  const onList = vi.fn();
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" onReviewOnList={onList} />);
  fireEvent.click(screen.getByRole("button", { name: "Packing slips" }));
  await screen.findByText("Read and filled in on the list");
  expect(screen.queryByRole("region", { name: "Packing slip camera" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Take photo" }));
  await screen.findByRole("region", { name: "Packing slip camera" });
  fireEvent.click(screen.getByRole("button", { name: "Cancel scan" }));
  fireEvent.click(await screen.findByRole("button", { name: /Check parts on the list/ }));
  expect(assign).toHaveBeenCalledWith("/jobs/job/receiving?document=doc");
});

it("sends per-slip clear and rerun actions for the current detection without confirming a receipt", async () => {
  let analysis={runId:"old-run",versionId:"version",status:"ready",startedAt:"2026-10-22",items:[],lines:[],warnings:[],applied:{at:"2026-10-22",by:"u",quantities:{}}};
  const actions:Record<string,unknown>[]=[];
  const verified=vi.fn();
  vi.stubGlobal("fetch",vi.fn(async (url:string,options?:RequestInit)=>{
    if(options?.method==="POST"){
      const body=JSON.parse(options.body as string) as Record<string, unknown>;actions.push(body);
      analysis={...analysis,runId:body.action==="clear"?"cleared-run":"new-run",status:body.action==="clear"?"cleared":"ready"};
      return Response.json({success:true});
    }
    return Response.json({canUpload:true,documents:[{id:"doc",name:"Packing slip - PO-123.pdf",createdAt:"2026-10-22",currentVersionId:"version",packingSlip:{orderId:"order",materialListId:"list",orderNumber:"PO-123"},packingSlipAnalysis:analysis}]});
  }));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" onVerified={verified}/>);
  fireEvent.click(screen.getByRole("button",{name:"Packing slips"}));
  fireEvent.click(await screen.findByRole("button",{name:"Clear detection"}));
  await screen.findByText("Detection cleared. Approved quantities and review decisions are preserved.");
  expect(actions[0]).toMatchObject({action:"clear",jobId:"job",documentId:"doc",runId:"old-run"});
  fireEvent.click(screen.getByRole("button",{name:"Rerun detection"}));
  await waitFor(()=>expect(actions).toHaveLength(2));
  expect(actions[1]).toMatchObject({action:"analyze",documentId:"doc",runId:"cleared-run"});
  expect(verified).not.toHaveBeenCalled();
  expect(actions.some(action=>action.action==="confirm")).toBe(false);
});

it("reads a confirmed slip again without taking back its approved quantities", async () => {
  let analysis:Record<string,unknown>={runId:"old-run",versionId:"version",status:"ready",startedAt:"2026-10-22",items:[],lines:[],warnings:[],applied:{at:"2026-10-22",by:"u",quantities:{item:6}}};
  const actions:Record<string,unknown>[]=[];
  const verified=vi.fn();
  vi.stubGlobal("fetch",vi.fn(async (_url:string,options?:RequestInit)=>{
    if(options?.method==="POST"){
      const body=JSON.parse(options.body as string) as Record<string, unknown>;actions.push(body);
      analysis={runId:"new-run",versionId:"version",status:"processing",startedAt:"2026-10-24",items:[],lines:[],warnings:[]};
      return Response.json({success:true});
    }
    return Response.json({canUpload:true,documents:[{id:"doc",name:"Packing slip - PO-123.pdf",createdAt:"2026-10-22",currentVersionId:"version",packingSlip:{orderId:"order",materialListId:"list",orderNumber:"PO-123"},packingSlipAnalysis:analysis}]});
  }));
  render(<PackingSlips jobId="job" materialListId="list" orderId="order" onVerified={verified}/>);
  fireEvent.click(screen.getByRole("button",{name:"Packing slips"}));
  fireEvent.click(await screen.findByRole("button",{name:"Rerun detection"}));
  await screen.findByText("Reading the slip again. Approved quantities are preserved.");
  expect(actions[0]).toMatchObject({action:"analyze",runId:"old-run"});
  expect(verified).not.toHaveBeenCalled();
});
