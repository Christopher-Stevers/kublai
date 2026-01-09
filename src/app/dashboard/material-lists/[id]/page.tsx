"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { MaterialListItem } from "~/components/materialLists/MaterialListItem";
import { JobInfoModal } from "~/components/materialLists/JobInfoModal";
import { QuotePreviewSheet } from "~/components/materialLists/QuotePreviewSheet";
import { OrdersPreviewSheet } from "~/components/materialLists/OrdersPreviewSheet";
import { AddPartDialog } from "~/components/materialLists/AddPartDialog";
import { useState } from "react";
import { PlusIcon, FileTextIcon, ShoppingCartIcon } from "lucide-react";

export default function MaterialListDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [showJobInfoModal, setShowJobInfoModal] = useState(false);
  const [showQuoteSheet, setShowQuoteSheet] = useState(false);
  const [showOrdersSheet, setShowOrdersSheet] = useState(false);
  const [showAddPartDialog, setShowAddPartDialog] = useState(false);

  const { data: materialList, isLoading } =
    api.materialList.getMaterialList.useQuery(
      { materialListId: id },
      { enabled: !!id },
    );

  const utils = api.useUtils();

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <p className="text-muted-foreground">Loading material list...</p>
      </div>
    );
  }

  if (!materialList) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground mb-4">Material list not found</p>
          <Button onClick={() => router.push("/dashboard/material-lists")}>
            Back to Material Lists
          </Button>
        </div>
      </div>
    );
  }

  const handleJobInfoClick = () => {
    setShowJobInfoModal(true);
  };

  const handleGenerateQuote = () => {
    if (
      !materialList.job.name ||
      materialList.job.name === "New Material List"
    ) {
      setShowJobInfoModal(true);
      return;
    }
    setShowQuoteSheet(true);
  };

  const handleGenerateOrder = () => {
    if (
      !materialList.job.name ||
      materialList.job.name === "New Material List"
    ) {
      setShowJobInfoModal(true);
      return;
    }
    setShowOrdersSheet(true);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top Bar */}
      <div className="border-b bg-white px-6 py-4">
        <div className="mx-auto max-w-6xl">
          <h1 className="text-2xl font-bold text-gray-900">Material List</h1>
          <button
            onClick={handleJobInfoClick}
            className="text-muted-foreground mt-1 text-sm hover:text-gray-900"
          >
            Job: {materialList.job.name || "Not set"}
          </button>
        </div>
      </div>

      {/* Main Area - Parts List */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto max-w-6xl">
          {materialList.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-muted-foreground mb-4">
                No parts added yet sucker
              </p>
              <Button onClick={() => setShowAddPartDialog(true)}>
                <PlusIcon className="mr-2 h-4 w-4" />
                Add Part
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {materialList.items.map((item) => (
                <MaterialListItem
                  key={String(item.id)}
                  item={item as {
                    id: string;
                    quantity: string;
                    unitCost: string | null;
                    extendedPrice: string | null;
                    descriptionSnapshot: string | null;
                    partDefinition: {
                      id: string;
                      displayName: string;
                      imageUrl: string | null;
                      material: string | null;
                    } | null;
                    supplierPart: {
                      id: string;
                      supplierId: string;
                      supplierSku: string | null;
                      lastKnownUnitCost: string | null;
                      supplier: {
                        id: string;
                        name: string;
                      } | null;
                    } | null;
                    uom: {
                      id: string;
                      code: string;
                      displayName: string | null;
                    } | null;
                  }}
                  materialListId={id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer - Always Visible */}
      <div className="border-t bg-white px-6 py-4">
        <div className="mx-auto max-w-6xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Material Total</p>
              <p className="text-2xl font-bold">
                ${materialList.materialTotal.toFixed(2)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowAddPartDialog(true)}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                Add Part
              </Button>
              <Button variant="outline" onClick={handleGenerateQuote}>
                <FileTextIcon className="mr-2 h-4 w-4" />
                Generate Quote
              </Button>
              <Button onClick={handleGenerateOrder}>
                <ShoppingCartIcon className="mr-2 h-4 w-4" />
                Generate Order
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modals and Sheets */}
      <JobInfoModal
        open={showJobInfoModal}
        onOpenChange={setShowJobInfoModal}
        materialListId={id}
        initialName={materialList.job.name}
        initialLocationId={materialList.job.locationId ?? undefined}
      />

      {showQuoteSheet && (
        <QuotePreviewSheet
          open={showQuoteSheet}
          onOpenChange={setShowQuoteSheet}
          materialListId={id}
          jobName={materialList.job.name}
        />
      )}

      {showOrdersSheet && (
        <OrdersPreviewSheet
          open={showOrdersSheet}
          onOpenChange={setShowOrdersSheet}
          materialListId={id}
        />
      )}

      <AddPartDialog
        open={showAddPartDialog}
        onOpenChange={setShowAddPartDialog}
        materialListId={id}
      />
    </div>
  );
}
