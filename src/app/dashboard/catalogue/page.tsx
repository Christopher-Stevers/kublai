"use client";

import { PackageIcon, WrenchIcon } from "lucide-react";
import { CatalogueScreen } from "~/components/catalogue/CatalogueScreen";
import { Button } from "~/components/ui/button";
import { usePageViewState } from "~/hooks/use-page-view-state";
import { currentSnapshotState } from "~/lib/snapshot-source";

type CatalogueKind = "materials" | "assets";

export default function CataloguePage() {
  const saved = currentSnapshotState()?.catalogue;
  const initialKind = saved?.scope === "/dashboard/catalogue" && saved.kind === "assets" ? "assets" : "materials";
  const [kind, setKind] = usePageViewState<CatalogueKind>("catalogue:kind", initialKind, ["materials", "assets"]);

  return (
    <>
      <div className="bg-card border-b px-3 py-2 sm:px-6">
        <div role="group" aria-label="Catalogues" className="mx-auto flex max-w-6xl gap-2">
          <Button aria-pressed={kind === "materials"}
            variant={kind === "materials" ? "default" : "outline"}
            className="h-9 gap-2" onClick={() => setKind("materials")}>
            <PackageIcon className="size-4" />Materials
          </Button>
          <Button aria-pressed={kind === "assets"}
            variant={kind === "assets" ? "default" : "outline"}
            className="h-9 gap-2" onClick={() => setKind("assets")}>
            <WrenchIcon className="size-4" />Tools
          </Button>
        </div>
      </div>
      <div>
        <CatalogueScreen key={kind} catalogKind={kind} />
      </div>
    </>
  );
}
