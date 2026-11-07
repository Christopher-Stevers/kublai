import { designIfc, type IfcExportObject } from "./cad-ifc";
import type { ModelDesign } from "./design";
self.onmessage = (
  event: MessageEvent<{
    design: ModelDesign;
    title: string;
    source: IfcExportObject[];
  }>,
) => {
  try {
    self.postMessage({
      text: designIfc(event.data.design, event.data.title, event.data.source),
    });
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : "Export failed.",
    });
  }
};
