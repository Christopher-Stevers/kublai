"use client";

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent } from "~/components/ui/card";
import { api } from "~/trpc/react";
import { cn } from "~/lib/utils";
import { CreativeUploader } from "./CreativeUploader";
import { Image as ImageIcon, Video, Trash2, Plus, X } from "lucide-react";
import {
  getCreativeImageUrl,
  isImageCreative,
  isVideoCreative,
} from "~/lib/creative-utils";

// Client-side file size formatter
function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i] ?? ""}`;
}

const MAX_CREATIVES = 5;

interface CreativeSelectorProps {
  selectedCreativeIds: string[];
  onCreativeAdd: (creativeId: string) => void;
  onCreativeRemove: (creativeId: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function CreativeSelector({
  selectedCreativeIds,
  onCreativeAdd,
  onCreativeRemove,
  onBack,
  onNext,
}: CreativeSelectorProps) {
  const [showUploader, setShowUploader] = useState(false);
  const {
    data: creatives,
    isLoading,
    refetch,
  } = api.creative.getMyCreatives.useQuery();
  const deleteCreativeMutation = api.creative.deleteCreative.useMutation({
    onSuccess: () => {
      void refetch();
      // Remove from selection if it was selected
      if (
        selectedCreativeIds.includes(
          deleteCreativeMutation.variables?.creativeId ?? "",
        )
      ) {
        onCreativeRemove(deleteCreativeMutation.variables?.creativeId ?? "");
      }
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-lg bg-white p-8 shadow-sm">
        <div className="text-center text-gray-600">Loading creatives...</div>
      </div>
    );
  }

  const handleUploadComplete = (creative: {
    id: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    mimeType: string;
    uploadDate: Date;
  }) => {
    void refetch();
    // Automatically add the newly uploaded creative if under max
    if (selectedCreativeIds.length < MAX_CREATIVES) {
      onCreativeAdd(creative.id);
    }
    setShowUploader(false);
  };

  const handleDelete = (e: React.MouseEvent, creativeId: string) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this creative?")) {
      deleteCreativeMutation.mutate({ creativeId });
    }
  };

  const handleAddCreative = (creativeId: string) => {
    if (
      selectedCreativeIds.length < MAX_CREATIVES &&
      !selectedCreativeIds.includes(creativeId)
    ) {
      onCreativeAdd(creativeId);
    }
  };

  const selectedCreatives =
    creatives?.filter((c) => selectedCreativeIds.includes(c.id)) ?? [];
  const isMaxReached = selectedCreativeIds.length >= MAX_CREATIVES;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              Select Creatives
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              Add up to {MAX_CREATIVES} creatives for your order or upload new
              ones
            </p>
            {selectedCreativeIds.length > 0 && (
              <p className="mt-1 text-sm font-medium text-gray-700">
                {selectedCreativeIds.length}/{MAX_CREATIVES} creatives selected
              </p>
            )}
          </div>
          {!showUploader && (
            <Button
              variant="outline"
              onClick={() => setShowUploader(true)}
              disabled={isMaxReached}
            >
              Upload New
            </Button>
          )}
        </div>

        {showUploader ? (
          <div className="mb-6">
            <CreativeUploader
              onUploadComplete={handleUploadComplete}
              onCancel={() => setShowUploader(false)}
            />
          </div>
        ) : null}

        {/* Selected Creatives Section */}
        {selectedCreatives.length > 0 && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="mb-3 text-sm font-semibold text-gray-900">
              Selected Creatives ({selectedCreatives.length}/{MAX_CREATIVES})
            </h3>
            <div className="flex flex-wrap gap-2">
              {selectedCreatives.map((creative) => {
                const imageUrl = getCreativeImageUrl({
                  id: creative.id,
                  fileName: creative.fileName,
                  fileType: creative.fileType,
                  filePath: creative.filePath,
                  userId: creative.userId,
                });
                return (
                  <div
                    key={creative.id}
                    className="group relative flex items-center gap-2 rounded-lg border border-gray-300 bg-white p-2 pr-8 shadow-sm"
                  >
                    {isImageCreative(creative) && imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={creative.fileName}
                        className="h-12 w-12 rounded object-cover"
                      />
                    ) : isVideoCreative(creative) && imageUrl ? (
                      <video
                        src={imageUrl}
                        controls
                        className="h-12 w-12 rounded object-cover"
                      >
                        Your browser does not support the video tag.
                      </video>
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-100">
                        <Video className="h-6 w-6 text-gray-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {creative.fileName}
                      </p>
                      <div className="flex gap-1">
                        <Badge
                          variant={
                            isImageCreative(creative) ? "secondary" : "outline"
                          }
                          className="text-xs"
                        >
                          {creative.fileType === "image" ? "Image" : "Video"}
                        </Badge>
                        {creative.approved &&
                          creative.approvedBy &&
                          creative.approvedAt && (
                            <Badge className="bg-green-100 text-xs text-green-800 hover:bg-green-100">
                              Approved
                            </Badge>
                          )}
                      </div>
                    </div>
                    <button
                      onClick={() => onCreativeRemove(creative.id)}
                      className="absolute top-1 right-1 rounded p-1 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                      title="Remove creative"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {isMaxReached && (
          <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 p-3">
            <p className="text-sm text-yellow-800">
              Maximum of {MAX_CREATIVES} creatives reached. Remove one to add
              another.
            </p>
          </div>
        )}

        {!creatives || creatives.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
            <p className="text-gray-600">
              {showUploader
                ? "Upload your first creative above"
                : "No creatives available. Click 'Upload New' to get started."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {creatives.map((creative) => {
              const isSelected = selectedCreativeIds.includes(creative.id);
              const canAdd = !isSelected && !isMaxReached;
              const imageUrl = getCreativeImageUrl({
                id: creative.id,
                fileName: creative.fileName,
                fileType: creative.fileType,
                filePath: creative.filePath,
                userId: creative.userId,
              });

              return (
                <Card
                  key={creative.id}
                  className={cn(
                    "relative transition-colors",
                    isSelected
                      ? "border-primary ring-primary ring-2"
                      : "hover:border-primary/50",
                  )}
                >
                  <CardContent className="p-4">
                    {/* Auto-show image and video previews */}
                    {isImageCreative(creative) && imageUrl ? (
                      <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
                        <img
                          src={imageUrl}
                          alt={creative.fileName}
                          className="h-full w-full rounded object-contain"
                          style={{ maxHeight: "200px" }}
                        />
                      </div>
                    ) : isVideoCreative(creative) && imageUrl ? (
                      <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-2">
                        <video
                          src={imageUrl}
                          controls
                          className="h-full w-full rounded"
                          style={{ maxHeight: "200px" }}
                        >
                          Your browser does not support the video tag.
                        </video>
                      </div>
                    ) : null}

                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        {isImageCreative(creative) ? (
                          <ImageIcon className="h-5 w-5 shrink-0 text-gray-400" />
                        ) : (
                          <Video className="h-5 w-5 shrink-0 text-gray-400" />
                        )}
                        <h3 className="line-clamp-1 truncate font-semibold text-gray-900">
                          {creative.fileName}
                        </h3>
                      </div>
                      <button
                        onClick={(e) => handleDelete(e, creative.id)}
                        className="shrink-0 rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                        title="Delete creative"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Add Button Row */}
                    <div className="mb-2 flex items-center gap-2">
                      {isSelected ? (
                        <Badge className="bg-primary text-primary-foreground">
                          Selected
                        </Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant={canAdd ? "default" : "outline"}
                          disabled={!canAdd}
                          onClick={() => handleAddCreative(creative.id)}
                          className="flex items-center gap-1"
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </Button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <p className="text-xs text-gray-500">
                        {formatFileSize(creative.fileSize)} •{" "}
                        {new Date(creative.uploadDate).toLocaleDateString()}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        <Badge
                          variant={
                            isImageCreative(creative) ? "secondary" : "outline"
                          }
                          className="text-xs"
                        >
                          {creative.fileType === "image" ? "Image" : "Video"}
                        </Badge>
                        {creative.approved &&
                          creative.approvedBy &&
                          creative.approvedAt && (
                            <Badge className="bg-green-100 text-xs text-green-800 hover:bg-green-100">
                              Approved
                            </Badge>
                          )}
                        {!creative.approved && (
                          <Badge
                            variant="outline"
                            className="border-yellow-300 text-xs text-yellow-800"
                          >
                            Pending Approval
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <Button variant="outline" onClick={onBack} className="flex-1">
          Back
        </Button>
        <Button onClick={onNext} className="flex-1">
          Continue
        </Button>
      </div>
    </div>
  );
}
