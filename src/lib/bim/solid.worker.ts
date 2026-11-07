import type ModuleFactory from "manifold-3d";
import { evaluateSolid, type SolidRequest } from "./solid-kernel";
self.onmessage = async (event: MessageEvent<SolidRequest>) => {
  try {
    // Serve the versioned Emscripten loader directly. Its Node-only dynamic
    // imports must not be resolved into a browser webpack bundle.
    const url = "/api/models/kernel/manifold-3.5.4.js";
    const { default: Module } = (await import(
      /* webpackIgnore: true */ url
    )) as { default: typeof ModuleFactory };
    const kernel = await Module({
      locateFile: () => "/api/models/wasm/manifold-3.5.4.wasm",
    });
    kernel.setup();
    self.postMessage({ result: evaluateSolid(kernel, event.data) });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "The solid operation failed.",
    });
  }
};
