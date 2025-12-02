"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "~/trpc/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Upload, X, Loader2 } from "lucide-react";

interface BoardTypeFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  boardTypeId?: string | null;
}

export function BoardTypeForm({
  isOpen,
  onClose,
  onSuccess,
  boardTypeId,
}: BoardTypeFormProps) {
  const utils = api.useUtils();
  const { data: boardType } = api.admin.getBoardType.useQuery(
    { boardTypeId: boardTypeId! },
    { enabled: !!boardTypeId },
  );

  const createMutation = api.admin.createBoardType.useMutation({
    onSuccess: () => {
      onSuccess();
    },
  });

  const updateMutation = api.admin.updateBoardType.useMutation({
    onSuccess: () => {
      onSuccess();
    },
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [dimensionX, setDimensionX] = useState<string>("");
  const [dimensionY, setDimensionY] = useState<string>("");
  const [slotCostPerDay, setSlotCostPerDay] = useState<string>("");
  const [backfillCostPerDay, setBackfillCostPerDay] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load board type data when editing
  useEffect(() => {
    if (boardType && isOpen) {
      setName(boardType.name);
      setDescription(boardType.description ?? "");
      setImageUrl(boardType.imageUrl ?? null);
      setDimensionX(boardType.dimensionX?.toString() ?? "");
      setDimensionY(boardType.dimensionY?.toString() ?? "");
      setSlotCostPerDay((boardType.slotCostPerDay / 100).toFixed(2));
      setBackfillCostPerDay((boardType.backfillCostPerDay / 100).toFixed(2));
      setPreview(boardType.imageUrl ?? null);
    } else if (!boardTypeId && isOpen) {
      // Reset form for new board type
      setName("");
      setDescription("");
      setImageUrl(null);
      setDimensionX("");
      setDimensionY("");
      setSlotCostPerDay("");
      setBackfillCostPerDay("");
      setSelectedFile(null);
      setPreview(null);
      setUploadError(null);
    }
  }, [boardType, boardTypeId, isOpen]);

  const handleFileSelect = useCallback((file: File) => {
    // Validate file type
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
    if (!validTypes.includes(file.type)) {
      setUploadError("Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.");
      return;
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File size must be less than 10MB.");
      return;
    }

    setSelectedFile(file);
    setUploadError(null);

    // Create preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileSelect(file);
      }
    },
    [handleFileSelect],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/upload/board-type-image", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      setImageUrl(data.imageUrl);
      setSelectedFile(null);
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Failed to upload file",
      );
    } finally {
      setIsUploading(false);
    }
  }, [selectedFile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      return;
    }

    const slotCostCents = Math.round(parseFloat(slotCostPerDay) * 100);
    const backfillCostCents = Math.round(parseFloat(backfillCostPerDay) * 100);

    if (isNaN(slotCostCents) || slotCostCents < 0) {
      return;
    }
    if (isNaN(backfillCostCents) || backfillCostCents < 0) {
      return;
    }

    const dimensionXNum = dimensionX ? parseInt(dimensionX, 10) : undefined;
    const dimensionYNum = dimensionY ? parseInt(dimensionY, 10) : undefined;

    if (dimensionX && (isNaN(dimensionXNum!) || dimensionXNum! <= 0)) {
      return;
    }
    if (dimensionY && (isNaN(dimensionYNum!) || dimensionYNum! <= 0)) {
      return;
    }

    const data = {
      name: name.trim(),
      description: description.trim() || undefined,
      imageUrl: imageUrl || undefined,
      slotCostPerDay: slotCostCents,
      backfillCostPerDay: backfillCostCents,
      dimensionX: dimensionXNum,
      dimensionY: dimensionYNum,
    };

    if (boardTypeId) {
      await updateMutation.mutateAsync({
        boardTypeId,
        ...data,
      });
    } else {
      await createMutation.mutateAsync(data);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {boardTypeId ? "Edit Board Type" : "Create Board Type"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={255}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full min-h-[80px] px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
            />
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Image
            </label>
            <div className="space-y-2">
              {preview && (
                <div className="relative inline-block">
                  <img
                    src={preview}
                    alt="Preview"
                    className="h-32 w-auto rounded border border-gray-300"
                  />
                  {selectedFile && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setPreview(imageUrl);
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                        }
                      }}
                      className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-1"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                  onChange={handleFileInputChange}
                  className="hidden"
                  id="board-type-image-upload"
                />
                <label
                  htmlFor="board-type-image-upload"
                  className="cursor-pointer"
                >
                  <Button type="button" variant="outline" asChild>
                    <span>
                      <Upload className="mr-2 h-4 w-4" />
                      {selectedFile ? "Change Image" : "Upload Image"}
                    </span>
                  </Button>
                </label>
                {selectedFile && (
                  <Button
                    type="button"
                    onClick={handleUpload}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      "Upload"
                    )}
                  </Button>
                )}
              </div>
              {uploadError && (
                <p className="text-sm text-red-600">{uploadError}</p>
              )}
            </div>
          </div>

          {/* Dimensions */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dimension X <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                value={dimensionX}
                onChange={(e) => setDimensionX(e.target.value)}
                required
                min="1"
                placeholder="Width"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dimension Y <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                value={dimensionY}
                onChange={(e) => setDimensionY(e.target.value)}
                required
                min="1"
                placeholder="Height"
              />
            </div>
          </div>

          {/* Costs */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Slot Cost Per Day (CAD) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={slotCostPerDay}
                onChange={(e) => setSlotCostPerDay(e.target.value)}
                required
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Backfill Cost Per Day (CAD) <span className="text-red-500">*</span>
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={backfillCostPerDay}
                onChange={(e) => setBackfillCostPerDay(e.target.value)}
                required
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Error Messages */}
          {createMutation.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">
                {createMutation.error.message}
              </p>
            </div>
          )}
          {updateMutation.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3">
              <p className="text-sm text-red-700">
                {updateMutation.error.message}
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading
                ? "Saving..."
                : boardTypeId
                  ? "Update Board Type"
                  : "Create Board Type"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

