import { importDxf, type DxfUnits } from "./cad-dxf-import";
self.onmessage = (event: MessageEvent<{ text: string; units: DxfUnits }>) => {
  try {
    self.postMessage({ result: importDxf(event.data.text, event.data.units) });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "DXF import failed.",
    });
  }
};
