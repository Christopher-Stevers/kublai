import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StartupHandoff } from "./StartupHandoff";
beforeEach(()=>{
 vi.useFakeTimers();
 document.body.innerHTML='<div id="app-startup-cover" style="opacity:1"></div><div id="app-startup-content"><div data-app-startup-loading>Loading</div></div>';
 vi.spyOn(HTMLElement.prototype,"getClientRects").mockImplementation(function(this:HTMLElement){return (this.hidden||this.style.display==="none"?[]:[{width:100,height:100}]) as unknown as DOMRectList;});
 vi.stubGlobal("requestAnimationFrame",(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),16));
 vi.stubGlobal("cancelAnimationFrame",(id:number)=>clearTimeout(id));
 vi.stubGlobal("matchMedia",()=>({matches:false}));
});
afterEach(()=>{cleanup();document.body.innerHTML="";vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("keeps the cover while a route is pending, then waits for page paint before fading",async()=>{
 render(<StartupHandoff/>);
 await act(()=>vi.advanceTimersByTimeAsync(5000));
 const cover=document.getElementById("app-startup-cover")!;
 expect(cover.style.opacity).toBe("1");
 await act(async()=>{document.getElementById("app-startup-content")!.innerHTML="<main>Ready page</main>";});
 expect(cover.style.opacity).toBe("1");
 await act(()=>vi.advanceTimersByTimeAsync(32));
 expect(cover.style.opacity).toBe("0");expect(cover.style.pointerEvents).toBe("none");
 await act(()=>vi.advanceTimersByTimeAsync(220));
 expect(document.getElementById("app-startup-cover")).toBeNull();
});
it("does not mistake script-only streaming content for a ready page",async()=>{
 document.getElementById("app-startup-content")!.innerHTML="<script>/* stream */</script>";
 render(<StartupHandoff/>);await act(()=>vi.advanceTimersByTimeAsync(1000));
 expect(document.getElementById("app-startup-cover")!.style.opacity).toBe("1");
});
it("does not hold a fast page for a minimum animation duration",async()=>{
 document.getElementById("app-startup-content")!.innerHTML="<main>Ready</main>";
 render(<StartupHandoff/>);await act(()=>vi.advanceTimersByTimeAsync(32));
 expect(document.getElementById("app-startup-cover")!.style.opacity).toBe("0");
});
