// @ts-nocheck
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ModelWorkspace } from "../../../src/components/models/JobModelsView";
import { AppDialogHost } from "../../../src/components/ui/app-dialogs";
window.deleted = [];
const model = {
  id: "10000000-0000-4000-8000-000000000001",
  seriesId: "10000000-0000-4000-8000-000000000001",
  version: 1,
  name: "Architecture",
  discipline: "architecture",
  filename: "architecture.ifc",
  format: "ifc",
  size: 1024,
  status: "ready",
  publication: "coordination",
  conversionMessage: null,
  uploadedBy: "Fixture",
  createdAt: new Date().toISOString(),
};
window.fixtureModels = [model];
function App() {
  const [models, setModels] = useState(window.fixtureModels);
  return (
    <>
      <ModelWorkspace
        workspace={{
          job: {
            id: "10000000-0000-4000-8000-000000000002",
            name: "Synthetic model test",
          },
          userId: "test",
          canUpload: true,
          canDelete: true,
          canConfigureAutodesk: false,
          conversionAvailable: true,
          models,
          views: [],
          issues: [],
          members: [],
        }}
        refresh={() => setModels([...window.fixtureModels])}
      />
      <AppDialogHost />
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
