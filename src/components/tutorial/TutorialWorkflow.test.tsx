import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect, type ReactNode } from "react";
import type * as MaterialRuntime from "~/lib/replicache-material-list";
import type * as CatalogueRuntime from "~/lib/replicache-catalogue";
import type { TutorialSandbox } from "./tutorial-sandbox-context";

const guards = vi.hoisted(() => ({ liveMaterial: vi.fn(), liveCatalogue: vi.fn(), fetch: vi.fn(), eventSource: vi.fn(), routerPush: vi.fn(), routerPrefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: guards.routerPush, replace: guards.routerPush, prefetch: guards.routerPrefetch }),
  usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@clerk/nextjs", () => ({ useAuth: () => ({ userId: "practice-user", isLoaded: true }), useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("~/server/api/root", () => ({}));
vi.mock("~/lib/replicache-material-list", async importOriginal => {
  const actual = await importOriginal<typeof MaterialRuntime>();
  return { ...actual,
    getMaterialListReplicache: guards.liveMaterial, tryGetMaterialListReplicache: guards.liveMaterial,
    requestMaterialListReplicacheSync: guards.liveMaterial, requestMaterialListReplicachePull: guards.liveMaterial,
    saveQuantityDurably: guards.liveMaterial,
  };
});
vi.mock("~/lib/replicache-catalogue", async importOriginal => {
  const actual = await importOriginal<typeof CatalogueRuntime>();
  return { ...actual, getCatalogueReplicache: guards.liveCatalogue, tryGetCatalogueReplicache: guards.liveCatalogue, requestCatalogueReplicachePull: guards.liveCatalogue };
});
vi.mock("~/components/jobs/FloorPlanCanvas", () => ({
  FloorPlanCanvas: ({ rooms, onSelectRoom }: { rooms: Array<{id: string; name: string}>; onSelectRoom: (id: string) => void }) => <div aria-label="Practice drawing">{rooms.map(room => <button key={room.id} onClick={() => onSelectRoom(room.id)}>Drawing room: {room.name}</button>)}</div>,
}));

import { DashboardClient } from "~/app/dashboard/DashboardClient";
import { TutorialSandboxProvider } from "./TutorialSandboxProvider";
import { TutorialOverlay } from "./TutorialOverlay";
import { Header } from "~/app/_components/Header";
import { useTutorialSandbox } from "./tutorial-sandbox-context";
import { requestHeaderBack, runHeaderBackOverride } from "~/lib/header-back-events";
import { DEMO_JOB_ID, DEMO_ROOM_ID } from "./tutorial-sandbox-fixtures";

let runtime: TutorialSandbox | null = null;
function Capture({ children }: { children: ReactNode }) {
  const sandbox = useTutorialSandbox();
  useEffect(() => { runtime = sandbox; }, [sandbox]);
  return children;
}
function target(name: string) {
  const element = document.querySelector(`[data-tutorial="${name}"]`);
  if (!element) throw new Error(`Tutorial target missing: ${name}`);
  return element;
}
const clickTarget = async (name: string) => {
  await waitFor(() => expect(document.querySelector(`[data-tutorial="${name}"]`)).not.toBeNull());
  fireEvent.click(target(name));
};
function GuidedWorkspace({ onFinish }: { onFinish: (outcome: "completed" | "skipped") => void }) {
  return <TutorialSandboxProvider userId="practice-user"><Capture><Header /><DashboardClient initialJobs={[]} /><TutorialOverlay onFinish={onFinish} /></Capture></TutorialSandboxProvider>;
}
async function guide(title: string) {
  await waitFor(() => expect(within(screen.getByLabelText("Tutorial guidance")).getByText(title, { exact: true })).toBeInTheDocument());
  // Give the DOM observer its frame to resolve a replaced option, e.g. PVC → XFR.
  await act(async () => { await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); });
}
function geometry() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const dialog = this.getAttribute("data-slot") === "dialog-content";
    const left = dialog ? 0 : 30;
    const top = dialog ? 60 : 240;
    const width = dialog ? 390 : 300;
    const height = dialog ? 700 : this.tagName === "ASIDE" ? 190 : 60;
    return { x: left, y: top, left, top, width, height, right: left + width, bottom: top + height, toJSON: () => ({}) };
  });
}
function expectIsolated(storageWrites: ReturnType<typeof vi.spyOn>) {
  expect(guards.fetch).not.toHaveBeenCalled();
  expect(guards.eventSource).not.toHaveBeenCalled();
  expect(guards.liveMaterial).not.toHaveBeenCalled();
  expect(guards.liveCatalogue).not.toHaveBeenCalled();
  expect(guards.routerPush).not.toHaveBeenCalled();
  expect(guards.routerPrefetch).not.toHaveBeenCalled();
  expect(storageWrites).not.toHaveBeenCalled();
}
async function back() { await act(async () => { if (!runHeaderBackOverride()) requestHeaderBack(); }); }

beforeEach(() => {
  runtime = null;
  vi.clearAllMocks();
  guards.liveMaterial.mockImplementation(() => { throw new Error("Production material runtime must not initialize"); });
  guards.liveCatalogue.mockImplementation(() => { throw new Error("Production catalogue runtime must not initialize"); });
  guards.fetch.mockImplementation(() => Promise.reject(new Error("Practice must not call fetch")));
  guards.eventSource.mockImplementation(() => { throw new Error("Practice must not open a stream"); });
  vi.stubGlobal("fetch", guards.fetch);
  vi.stubGlobal("EventSource", guards.eventSource);
  vi.stubGlobal("ResizeObserver", class { observe() { return undefined; } unobserve() { return undefined; } disconnect() { return undefined; } });
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("tutorial on the real ForemanHQ workflow", () => {
  it("uses actual job, list, add-parts, room notes, material request, and chat screens without production effects", async () => {
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    render(<TutorialSandboxProvider userId="practice-user"><Capture><DashboardClient initialJobs={[]} /></Capture></TutorialSandboxProvider>);
    fireEvent.click(await screen.findByText("Riverside Community Centre"));
    await clickTarget("material-lists");
    await clickTarget("create-list");
    await waitFor(() => expect(target("material-list")).toHaveTextContent(/\d{4}/));
    await clickTarget("add-part");
    await screen.findByRole("heading", { name: "Select Catalog" });
    fireEvent.click(await screen.findByText("Plumbing", { exact: true }));
    await screen.findByRole("heading", { name: "Select Material" });
    fireEvent.click(await screen.findByText("PVC", { exact: true }));
    await screen.findByRole("heading", { name: "Select PVC type" });
    fireEvent.click(await screen.findByText("XFR", { exact: true }));
    await screen.findByRole("heading", { name: "Select Size" });
    fireEvent.pointerUp(await screen.findByText('2"', { exact: true }));
    await screen.findByRole("heading", { name: "Select Category" });
    fireEvent.click(await screen.findByText("Fittings", { exact: true }));
    fireEvent.pointerUp(await screen.findByText('2" XFR 90', { exact: true }));
    await clickTarget("wizard-review-button");
    await waitFor(() => expect(target("wizard-confirm")).toBeEnabled());
    fireEvent.click(target("wizard-confirm"));
    await waitFor(() => expect(document.querySelector('[data-tutorial="add-part-dialog"]')).toBeNull());
    expect(await screen.findByText('2" XFR 90', { exact: true })).toBeInTheDocument();
    const items = await runtime!.material.query(tx => tx.scan({ prefix: "materialListItem/" }).values().toArray());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ quantity: "1", roomId: null });

    await back();
    await screen.findByRole("heading", { name: "Material Lists" });
    await back();
    await clickTarget("rooms");
    fireEvent.click(await screen.findByText("Ground floor", { exact: true }));
    fireEvent.click(await screen.findByRole("button", { name: "Drawing room: Mechanical room" }));
    const notes = await screen.findByLabelText("Room notes");
    fireEvent.change(notes, { target: { value: "Check clearance above the boiler." } });
    fireEvent.click(screen.getByRole("button", { name: "Save notes" }));
    await screen.findByText("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Request material" }));
    await waitFor(() => expect(target("material-list")).toHaveTextContent("Mechanical room"));
    const lists = await runtime!.material.query(tx => tx.scan({ prefix: "materialList/" }).values().toArray());
    expect(lists).toEqual(expect.arrayContaining([expect.objectContaining({ jobId: DEMO_JOB_ID, roomId: DEMO_ROOM_ID, roomName: "Mechanical room" })]));
    await back();
    // The room request opens from Rooms; return through the normal header history.
    for (let count = 0; count < 4 && !document.querySelector('[data-tutorial="chat"]'); count++) await back();
    await clickTarget("chat");
    fireEvent.change(await screen.findByLabelText("Message", { exact: true }), { target: { value: "Practice materials are ready." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText("Practice materials are ready.", { exact: true })).toBeInTheDocument();

    expect(guards.fetch).not.toHaveBeenCalled();
    expect(guards.eventSource).not.toHaveBeenCalled();
    expect(guards.liveMaterial).not.toHaveBeenCalled();
    expect(guards.liveCatalogue).not.toHaveBeenCalled();
    expect(guards.routerPush).not.toHaveBeenCalled();
    expect(guards.routerPrefetch).not.toHaveBeenCalled();
    expect(storageWrites).not.toHaveBeenCalled();
  }, 20000);

  it("completes the real workflow with the guide, header back arrow, and Rooms list", async () => {
    geometry();
    const onFinish = vi.fn();
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    render(<GuidedWorkspace onFinish={onFinish} />);
    await guide("Select your job");
    await clickTarget("job-card");
    await guide("Open Material Lists");
    await clickTarget("material-lists");
    await guide("Create a material list");
    await clickTarget("create-list");
    await guide("Add material");
    await clickTarget("add-part");
    await guide("Select a catalog");
    expect(screen.getByRole("region", { name: "Add Parts" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "End tutorial" })).toBeInTheDocument();
    fireEvent.click(await screen.findByText("Plumbing", { exact: true }));
    await guide("Select your material");
    fireEvent.click(await screen.findByText("PVC", { exact: true }));
    await screen.findByRole("heading", { name: "Select PVC type" });
    await guide("Select your material");
    fireEvent.click(await screen.findByText("XFR", { exact: true }));
    await guide("Select the size");
    fireEvent.pointerUp(await screen.findByText('2"', { exact: true }));
    await guide("Select a category");
    fireEvent.click(await screen.findByText("Fittings", { exact: true }));
    await guide("Select a part");
    fireEvent.pointerUp(await screen.findByText('2" XFR 90', { exact: true }));
    await guide("Review your selected parts");
    await clickTarget("wizard-review-button");
    await guide("Add the material to your list");
    expect(screen.getByRole("button", { name: "End tutorial" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), { target: { value: "3" } });
    await waitFor(() => expect(target("wizard-confirm")).toBeEnabled());
    await clickTarget("wizard-confirm");
    await guide("Back to your job");
    const items = await runtime!.material.query(tx => tx.scan({ prefix: "materialListItem/" }).values().toArray());
    expect(items).toEqual([expect.objectContaining({ quantity: "3", roomId: null })]);
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await screen.findByRole("heading", { name: "Material Lists" });
    await guide("Back to your job");
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await guide("Open Rooms");
    await clickTarget("rooms");
    await guide("Open a floor");
    await clickTarget("floor-card");
    await guide("Explore the drawing");
    await clickTarget("room-list-toggle");
    await guide("Open a room");
    // Use the real list/selection controls, never the mocked canvas buttons.
    await clickTarget("room-list-item");
    await guide("Notes stay with the room");
    fireEvent.change(screen.getByLabelText("Room notes"), { target: { value: "Check the practice boiler clearance." } });
    await clickTarget("room-notes-save");
    await screen.findByText("Saved");
    fireEvent.click(screen.getByRole("button", { name: "Next: Chat" }));
    // Header back walks room → floor → rooms → job, with guidance active.
    for (let count = 0; count < 4 && !document.querySelector('[data-tutorial="chat"]'); count++) {
      await guide("Back to your job");
      fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    }
    await guide("Open Chat");
    await clickTarget("chat");
    await guide("Send a practice message");
    fireEvent.input(screen.getByLabelText("Message", { exact: true }), { target: { value: "The tutorial works through the real app." } });
    await guide("Send a practice message");
    await clickTarget("chat-send");
    await guide("You're ready");
    expect(screen.getByText("The tutorial works through the real app.", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish tutorial" }));
    expect(onFinish).toHaveBeenCalledExactlyOnceWith("completed");
    expectIsolated(storageWrites);
  }, 20000);

  it("allows ending from the Add Parts screen without invoking its close controls or production effects", async () => {
    geometry();
    const onFinish = vi.fn();
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    render(<GuidedWorkspace onFinish={onFinish} />);
    await guide("Select your job");
    await clickTarget("job-card");
    await guide("Open Material Lists");
    await clickTarget("material-lists");
    await guide("Create a material list");
    await clickTarget("create-list");
    await guide("Add material");
    await clickTarget("add-part");
    await guide("Select a catalog");
    expect(screen.getByRole("region", { name: "Add Parts" })).toBeInTheDocument();
    const end = screen.getByRole("button", { name: "End tutorial" });
    end.focus();
    expect(end).toHaveFocus();
    fireEvent.pointerDown(end);
    fireEvent.pointerUp(end);
    fireEvent.click(end);
    expect(onFinish).toHaveBeenCalledExactlyOnceWith("skipped");
    expectIsolated(storageWrites);
  }, 20000);
});
