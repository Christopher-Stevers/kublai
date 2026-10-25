"use client";

import { AssetsNav } from "~/components/assets/shared";
import { CatalogueScreen } from "~/components/catalogue/CatalogueScreen";

export default function ToolTypesPage() {
  return (
    <>
      <div className="px-4 pt-6 sm:px-6 sm:pt-8">
        <div className="mx-auto max-w-6xl">
          <AssetsNav />
        </div>
      </div>
      <CatalogueScreen catalogKind="assets" />
    </>
  );
}
