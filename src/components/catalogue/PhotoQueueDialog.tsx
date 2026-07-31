"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Clipboard,
  ExternalLink,
  ImagePlus,
  Package,
  SkipForward,
  Upload,
} from "lucide-react";
import { api } from "~/trpc/react";
import { Button } from "~/components/ui/button";
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
            Photo Queue
          </DialogTitle>
          <DialogDescription>
            {data
              ? `${data.missingPartCount} missing photos in ${data.groups.length} ${data.groups.length === 1 ? "family" : "families"}`
              : "Loading missing catalogue photos..."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-3 sm:p-6">
          {isLoading ? (
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

        <div className="shrink-0 border-t bg-white px-4 py-3 text-xs text-gray-600 sm:px-6">
          {groups.length} families remaining · {visiblePartCount} parts still
          visible in this session
        </div>
      </DialogContent>
    </Dialog>
  );
}
