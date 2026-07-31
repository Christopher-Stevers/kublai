"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  ExternalLink,
  ImagePlus,
  Library,
  Package,
  Replace,
  Search,
  SkipForward,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";

type PhotoQueueDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalogId?: string | null;
  materialId?: string | null;
  categoryId?: string | null;
};

async function uploadPhotoQueueImage(file: File) {
  const body = new FormData();
  body.append("file", file);
  const response = await fetch("/api/catalogue/images", {
    method: "POST",
    body,
  });
  const result = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !result.url) {
    throw new Error(result.error ?? "Image upload failed");
  }
  return result.url;
}

function PhotoLibrary() {
  const utils = api.useUtils();
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [replacementSourceId, setReplacementSourceId] = useState<string | null>(
    null,
  );
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: assets = [], isLoading } =
    api.catalogue.listPhotoAssets.useQuery({
      query: query.trim() || undefined,
      unusedOnly,
      duplicatesOnly,
    });
  const deleteAsset = api.catalogue.deleteUnusedPhotoAsset.useMutation();
  const replaceAsset = api.catalogue.replacePhotoAssetEverywhere.useMutation();

  const refresh = async () => {
    await Promise.all([
      utils.catalogue.listPhotoAssets.invalidate(),
      utils.catalogue.getPhotoQueue.invalidate(),
      utils.catalogue.searchParts.invalidate(),
      utils.catalogue.getPartWizardSummary.invalidate(),
    ]);
  };

  const handleUpload = async (file: File) => {
    try {
      setError(null);
      setIsUploading(true);
      await uploadPhotoQueueImage(file);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (assetId: string) => {
    if (!window.confirm("Permanently delete this unused photo asset?")) return;
    try {
      setError(null);
      await deleteAsset.mutateAsync({ assetId });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Delete failed");
    }
  };

  const handleReplacement = async (replacementAssetId: string) => {
    if (!replacementSourceId) return;
    try {
      setError(null);
      await replaceAsset.mutateAsync({
        sourceAssetId: replacementSourceId,
        replacementAssetId,
      });
      setReplacementSourceId(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Replace failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-xl border bg-white p-3 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search filenames, source URLs, or notes"
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant={unusedOnly ? "default" : "outline"}
          onClick={() => setUnusedOnly((value) => !value)}
        >
          Unused
        </Button>
        <Button
          type="button"
          variant={duplicatesOnly ? "default" : "outline"}
          onClick={() => setDuplicatesOnly((value) => !value)}
        >
          Duplicates
        </Button>
        <Button
          type="button"
          onClick={() => uploadRef.current?.click()}
          disabled={isUploading}
        >
          <Upload className="h-4 w-4" />
          {isUploading ? "Uploading..." : "Upload"}
        </Button>
        <input
          ref={uploadRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void handleUpload(file);
          }}
        />
      </div>

      {replacementSourceId && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Choose another photo below to replace this asset everywhere, or{" "}
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => setReplacementSourceId(null)}
          >
            cancel
          </button>
          .
        </div>
      )}
      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-gray-600">
          Loading photo assets...
        </div>
      ) : assets.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-sm text-gray-600">
          No photo assets match these filters.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <article
              key={asset.id}
              className={`overflow-hidden rounded-xl border bg-white ${
                replacementSourceId === asset.id ? "ring-2 ring-amber-500" : ""
              }`}
            >
              <div className="relative aspect-square bg-gray-50">
                <Image
                  src={asset.url}
                  alt={asset.originalFilename ?? "Catalogue photo"}
                  fill
                  className="object-contain p-2"
                  unoptimized
                />
              </div>
              <div className="space-y-2 p-3">
                <div
                  className="truncate text-xs font-medium text-gray-900"
                  title={asset.originalFilename ?? asset.url}
                >
                  {asset.originalFilename ?? asset.storageKey}
                </div>
                <div className="flex flex-wrap gap-1 text-[11px] text-gray-600">
                  <span className="rounded bg-gray-100 px-1.5 py-0.5">
                    {asset.usageCount} uses
                  </span>
                  {asset.duplicateCount > 1 && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">
                      {asset.duplicateCount} duplicates
                    </span>
                  )}
                  {asset.byteSize && (
                    <span className="rounded bg-gray-100 px-1.5 py-0.5">
                      {(asset.byteSize / 1024).toFixed(0)} KB
                    </span>
                  )}
                </div>
                {replacementSourceId && replacementSourceId !== asset.id ? (
                  <Button
                    type="button"
                    size="sm"
                    className="w-full"
                    onClick={() => void handleReplacement(asset.id)}
                    disabled={replaceAsset.isPending}
                  >
                    Use as replacement
                  </Button>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setReplacementSourceId(asset.id)}
                      disabled={asset.usageCount === 0}
                      title="Replace this photo everywhere"
                    >
                      <Replace className="h-3.5 w-3.5" />
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDelete(asset.id)}
                      disabled={asset.usageCount > 0 || deleteAsset.isPending}
                      title={
                        asset.usageCount > 0
                          ? "Assigned photos cannot be deleted"
                          : "Delete unused photo"
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

export function PhotoQueueDialog({
  open,
  onOpenChange,
  catalogId,
  materialId,
  categoryId,
}: PhotoQueueDialogProps) {
  const utils = api.useUtils();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [skippedGroupIds, setSkippedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedPartIds, setSelectedPartIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"queue" | "library">("queue");

  const queueInput = {
    catalogId: catalogId ?? undefined,
    materialId: materialId ?? undefined,
    categoryId: categoryId ?? undefined,
  };
  const { data, isLoading } = api.catalogue.getPhotoQueue.useQuery(queueInput, {
    enabled: open,
  });
  const groups = useMemo(
    () =>
      (data?.groups ?? []).filter((group) => !skippedGroupIds.has(group.id)),
    [data?.groups, skippedGroupIds],
  );
  const currentGroup = groups[0] ?? null;

  useEffect(() => {
    if (!open) {
      setSkippedGroupIds(new Set());
      setSelectedPartIds(new Set());
      setImageUrl(null);
      setError(null);
      setActiveTab("queue");
    }
  }, [open]);

  useEffect(() => {
    if (!currentGroup) {
      setSelectedPartIds(new Set());
      setImageUrl(null);
      return;
    }
    setSelectedPartIds(new Set(currentGroup.parts.map((part) => part.id)));
    setImageUrl(currentGroup.existingImageUrl);
    setError(null);
  }, [currentGroup?.id]);

  const storeRemoteImage =
    api.catalogue.storeRemoteCatalogueImage.useMutation();
  const applyImage = api.catalogue.applyPhotoQueueImage.useMutation({
    onSuccess: async () => {
      setImageUrl(null);
      await Promise.all([
        utils.catalogue.getPhotoQueue.invalidate(),
        utils.catalogue.searchParts.invalidate(),
        utils.catalogue.getPartWizardSummary.invalidate(),
      ]);
    },
  });

  const attachFile = async (file: File) => {
    try {
      setError(null);
      setIsProcessingImage(true);
      setImageUrl(await uploadPhotoQueueImage(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image upload failed");
    } finally {
      setIsProcessingImage(false);
    }
  };

  const pasteImage = async () => {
    if (!navigator.clipboard) {
      setError("Clipboard access is not available in this browser.");
      return;
    }

    try {
      setError(null);
      setIsProcessingImage(true);
      if ("read" in navigator.clipboard) {
        const clipboardItems = await navigator.clipboard.read().catch(() => []);
        for (const item of clipboardItems) {
          const imageType = item.types.find((type) =>
            type.toLowerCase().startsWith("image/"),
          );
          if (!imageType) continue;
          const blob = await item.getType(imageType);
          await attachFile(
            new File([blob], "photo-queue-image", { type: imageType }),
          );
          return;
        }
      }

      const remoteUrl = (await navigator.clipboard.readText()).trim();
      if (!remoteUrl) {
        throw new Error("Clipboard does not contain an image or image URL.");
      }
      const stored = await storeRemoteImage.mutateAsync({
        imageUrl: remoteUrl,
      });
      setImageUrl(stored.imageUrl);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not paste image",
      );
    } finally {
      setIsProcessingImage(false);
    }
  };

  const togglePart = (partId: string) => {
    setSelectedPartIds((current) => {
      const next = new Set(current);
      if (next.has(partId)) next.delete(partId);
      else next.add(partId);
      return next;
    });
  };

  const handleApply = async () => {
    if (!imageUrl || selectedPartIds.size === 0) return;
    try {
      setError(null);
      await applyImage.mutateAsync({
        imageUrl,
        partIds: Array.from(selectedPartIds),
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not apply photo",
      );
    }
  };

  const handleSkip = () => {
    if (!currentGroup) return;
    setSkippedGroupIds((current) => new Set(current).add(currentGroup.id));
  };

  const visiblePartCount = groups.reduce(
    (total, group) => total + group.parts.length,
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden p-0 sm:h-[90vh]">
        <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 sm:px-6">
          <DialogTitle className="flex items-center gap-2">
            <ImagePlus className="h-5 w-5" />
            Catalogue Photos
          </DialogTitle>
          <DialogDescription>
            {activeTab === "library"
              ? "Search, reuse, replace, and safely clean up stored photo assets."
              : data
                ? `${data.missingPartCount} missing photos in ${data.groups.length} ${data.groups.length === 1 ? "family" : "families"}`
                : "Loading missing catalogue photos..."}
          </DialogDescription>
          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              size="sm"
              variant={activeTab === "queue" ? "default" : "outline"}
              onClick={() => setActiveTab("queue")}
            >
              <ImagePlus className="h-4 w-4" />
              Queue
            </Button>
            <Button
              type="button"
              size="sm"
              variant={activeTab === "library" ? "default" : "outline"}
              onClick={() => setActiveTab("library")}
            >
              <Library className="h-4 w-4" />
              Library
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-3 sm:p-6">
          {activeTab === "library" ? (
            <PhotoLibrary />
          ) : isLoading ? (
            <div className="rounded-xl border bg-white p-6 text-sm text-gray-600">
              Grouping missing photos...
            </div>
          ) : !currentGroup ? (
            <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border bg-white p-8 text-center">
              <Check className="mb-3 h-10 w-10 text-green-600" />
              <h2 className="text-lg font-semibold text-gray-900">
                Queue complete
              </h2>
              <p className="mt-1 max-w-md text-sm text-gray-600">
                Every visible family has a photo or was skipped for this
                session.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="space-y-4 rounded-xl border bg-white p-4">
                <div>
                  <div className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
                    {currentGroup.catalogName} ·{" "}
                    {currentGroup.materialName ?? "No material"} ·{" "}
                    {currentGroup.categoryName ?? "No category"}
                  </div>
                  <h2 className="mt-1 text-xl font-bold text-gray-950">
                    {currentGroup.familyLabel}
                  </h2>
                  <p className="mt-1 text-sm text-gray-600">
                    Review the {currentGroup.parts.length} matching parts before
                    sharing one photo.
                  </p>
                </div>

                <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                  {currentGroup.parts.map((part) => (
                    <label
                      key={part.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-gray-50"
                    >
                      <input
                        type="checkbox"
                        aria-label={part.displayName}
                        className="mt-1 h-4 w-4"
                        checked={selectedPartIds.has(part.id)}
                        onChange={() => togglePart(part.id)}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900">
                          {part.displayName}
                        </span>
                        <span className="block text-xs text-gray-500">
                          {[part.size, part.description]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              <aside className="space-y-3 rounded-xl border bg-white p-4">
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border bg-gray-50">
                  {imageUrl ? (
                    <Image
                      src={imageUrl}
                      alt={`${currentGroup.familyLabel} preview`}
                      fill
                      className="object-contain p-2"
                      unoptimized
                    />
                  ) : (
                    <Package className="h-14 w-14 text-gray-300" />
                  )}
                </div>

                {currentGroup.existingImageUrl && (
                  <p className="rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
                    A reviewed photo already exists in this family.
                  </p>
                )}

                <div className="grid gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      window.open(
                        currentGroup.googleSearchUrl,
                        "_blank",
                        "noopener,noreferrer",
                      )
                    }
                  >
                    <ExternalLink className="h-4 w-4" />
                    Search Google
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void pasteImage()}
                    disabled={isProcessingImage}
                  >
                    <Clipboard className="h-4 w-4" />
                    {isProcessingImage ? "Processing..." : "Paste Image"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessingImage}
                  >
                    <Upload className="h-4 w-4" />
                    Upload File
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (file) void attachFile(file);
                    }}
                  />
                </div>

                {error && (
                  <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </p>
                )}

                <div className="grid grid-cols-2 gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSkip}
                    disabled={applyImage.isPending}
                  >
                    <SkipForward className="h-4 w-4" />
                    Skip
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleApply()}
                    disabled={
                      !imageUrl ||
                      selectedPartIds.size === 0 ||
                      applyImage.isPending
                    }
                  >
                    <Check className="h-4 w-4" />
                    {applyImage.isPending
                      ? "Applying..."
                      : `Apply to ${selectedPartIds.size}`}
                  </Button>
                </div>
              </aside>
            </div>
          )}
        </div>

        {activeTab === "queue" && (
          <div className="shrink-0 border-t bg-white px-4 py-3 text-xs text-gray-600 sm:px-6">
            {groups.length} families remaining · {visiblePartCount} parts still
            visible in this session
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
