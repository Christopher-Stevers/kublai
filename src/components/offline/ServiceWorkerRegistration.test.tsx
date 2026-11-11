import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { holdReleaseWork } from "~/lib/release-safety";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type * as ReleaseUpdateModule from "~/lib/release-update";
import { afterEach, expect, it, vi } from "vitest";
const reload = vi.hoisted(() => vi.fn());
vi.mock("~/lib/replicache-material-list", () => ({}));
vi.mock("~/lib/drawing-offline-queue", () => ({}));
vi.mock("~/lib/offline-test", () => ({isOfflineTestEnabled: () => false}));
vi.mock("~/lib/release-update", async importOriginal => {
  const actual = await importOriginal<typeof ReleaseUpdateModule>();
  return {...actual, reloadReleaseOnce: (build: string, storage: Storage) => actual.reloadReleaseOnce(build, storage, reload)};
});
import { ServiceWorkerRegistration } from "./ServiceWorkerRegistration";
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); sessionStorage.clear(); reload.mockClear(); });

it("warms a good-link release but does not swap during a mutation or unsaved input", async () => {
  await Promise.all([import("~/lib/private-background-work"), import("~/lib/drawing-offline-queue"), import("~/lib/replicache-material-list")]);
  vi.useFakeTimers(); vi.stubEnv("NEXT_PUBLIC_BUILD_ID", "a".repeat(64));
  class Channel {
    port1: {onmessage?: (event: {data: unknown}) => void; close: () => void} = {close: () => undefined};
    port2 = {respond: (data: unknown) => this.port1.onmessage?.({data})};
  }
  vi.stubGlobal("MessageChannel", Channel);
  const postMessage = vi.fn((data: {type: string; build: string}, ports?: {respond(data: unknown): void}[]) => {
    if (data.type === "FOREMENHQ_WARM_RELEASE") ports?.[0]?.respond({ready:true,build:data.build});
  });
  const worker = {postMessage};
  const registration = {active:worker,waiting:null,installing:null,update:async()=>undefined,addEventListener:()=>undefined,removeEventListener:()=>undefined};
  vi.stubGlobal("navigator", {onLine:true,connection:{effectiveType:"4g",downlink:10},serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration),controller:worker,addEventListener:()=>undefined,removeEventListener:()=>undefined}});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({build:"b".repeat(64)})));
  const client = new QueryClient();
  const mutations = vi.spyOn(client,"isMutating").mockReturnValue(1);
  render(<QueryClientProvider client={client}><ServiceWorkerRegistration/><input aria-label="draft" defaultValue=""/><div contentEditable suppressContentEditableWarning aria-label="note"/></QueryClientProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
  expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({type:"FOREMENHQ_WARM_RELEASE",goodLink:true}),expect.any(Array));
  expect(reload).not.toHaveBeenCalled();
  mutations.mockReturnValue(0);
  const input=screen.getByLabelText<HTMLInputElement>("draft");
  vi.spyOn(input,"getClientRects").mockReturnValue({length:1} as DOMRectList);
  fireEvent.input(input,{target:{value:"unsaved text"}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
  expect(reload).not.toHaveBeenCalled();
  const releaseUpload = holdReleaseWork();
  fireEvent.input(input,{target:{value:""}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
  expect(reload).not.toHaveBeenCalled();
  const editor=screen.getByLabelText("note");
  vi.spyOn(editor,"getClientRects").mockReturnValue({length:1} as DOMRectList);
  editor.textContent="unsaved rich draft";
  releaseUpload();
  await act(async()=>{await vi.advanceTimersByTimeAsync(100);});
  expect(reload).not.toHaveBeenCalled();
  const veto=(event:Event)=>event.preventDefault();
  window.addEventListener("beforeunload",veto);
  await act(async()=>{editor.textContent="";await vi.advanceTimersByTimeAsync(100);});
  expect(reload).not.toHaveBeenCalled();
  window.removeEventListener("beforeunload",veto);
  // The editor finishes saving without any further pointer/key/input event.
  await act(async()=>{editor.setAttribute("data-save-state","saved");await vi.advanceTimersByTimeAsync(100);});
  expect(reload).toHaveBeenCalledTimes(1);
});

it("can quietly activate a waiting worker for the already loaded build without reloading it", async () => {
  await Promise.all([import("~/lib/private-background-work"), import("~/lib/drawing-offline-queue"), import("~/lib/replicache-material-list")]);
  vi.useFakeTimers();vi.stubEnv("NEXT_PUBLIC_BUILD_ID","a".repeat(64));
  class Channel {
    port1: {onmessage?: (event:{data:unknown})=>void;close:()=>void}={close:()=>undefined};
    port2={respond:(data:unknown)=>this.port1.onmessage?.({data})};
  }
  vi.stubGlobal("MessageChannel",Channel);
  const postMessage=vi.fn((data:{type:string;build:string},ports?:{respond(data:unknown):void}[])=>{
    if(data.type==="FOREMENHQ_WARM_RELEASE")ports?.[0]?.respond({ready:true,build:data.build});
  });
  const worker={postMessage};
  const registration={active:worker,waiting:worker,installing:null,update:async()=>undefined,addEventListener:()=>undefined,removeEventListener:()=>undefined};
  vi.stubGlobal("navigator",{onLine:true,connection:{effectiveType:"4g",downlink:10},serviceWorker:{register:async()=>registration,ready:Promise.resolve(registration),controller:worker,addEventListener:()=>undefined,removeEventListener:()=>undefined}});
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({build:"a".repeat(64)})));
  render(<QueryClientProvider client={new QueryClient()}><ServiceWorkerRegistration/></QueryClientProvider>);
  await act(async()=>{await vi.advanceTimersByTimeAsync(6000);});
  expect(postMessage).toHaveBeenCalledWith({type:"FOREMENHQ_ACTIVATE_RELEASE"});
  expect(reload).not.toHaveBeenCalled();
});
