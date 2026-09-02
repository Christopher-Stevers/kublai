"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  DoorOpenIcon,
  PencilIcon,
  SparklesIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { FloorPlanCanvas, type FloorRoomShape } from "./FloorPlanCanvas";
import { getRoomColor } from "~/lib/room-colors";
import { api } from "~/trpc/react";

export function JobRoomsView({ jobId }: { jobId: string }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [detectMode, setDetectMode] = useState(false);
  const [detectingRoomId, setDetectingRoomId] = useState<string | null>(null);
  const [vertexMode, setVertexMode] = useState<"add" | "delete" | null>(null);
  const handledDetectJob = useRef("");
  const floorRenameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floorNameDraftRef = useRef("");
  const [isRoomListOpen, setIsRoomListOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  const [floorNameDraft, setFloorNameDraft] = useState("");
  const [roomNameDraft, setRoomNameDraft] = useState("");
  const [floorToDelete, setFloorToDelete] = useState<{
    id: string;
    name: string;
    roomCount: number;
  } | null>(null);
  const [roomsToDelete, setRoomsToDelete] = useState<{
    floorId: string;
    floorName: string;
    roomCount: number;
  } | null>(null);
  const utils = api.useUtils();
  const roomsQuery = api.rooms.getJobRooms.useQuery({ jobId });
  const renameFloor = api.rooms.renameFloor.useMutation({
    onSuccess: () => void utils.rooms.getJobRooms.invalidate({ jobId }),
  });
  const confirmFloor = api.rooms.confirmFloor.useMutation({
    onSuccess: () => void utils.rooms.getJobRooms.invalidate({ jobId }),
  });
  const addRoom = api.rooms.addRoom.useMutation({
    onSuccess: async (room) => {
      await utils.rooms.getJobRooms.invalidate({ jobId });
      if (room?.id) {
        setSelectedRoomId(null);
        setEditingRoomId(room.id);
        setRoomNameDraft(room.name);
      }
    },
  });
  const updateRoom = api.rooms.updateRoom.useMutation();
  const deleteRoom = api.rooms.deleteRoom.useMutation({
    onSuccess: () => {
      setSelectedRoomId(null);
      setEditingRoomId(null);
      setVertexMode(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
    },
  });
  const deleteAllRooms = api.rooms.deleteAllRooms.useMutation({
    onSuccess: () => {
      setRoomsToDelete(null);
      setSelectedRoomId(null);
      setEditingRoomId(null);
      setVertexMode(null);
      setCreateMode(false);
      void utils.rooms.getJobRooms.invalidate({ jobId });
    },
  });
  const deleteFloor = api.rooms.deleteFloor.useMutation({
    onSuccess: () => {
      setFloorToDelete(null);
      setSelectedFloorId(null);
      setSelectedRoomId(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
    },
  });
  const detectRoomsAi = api.rooms.detectRoomsAi.useMutation({
    onSuccess: () => {
      setDetectError(null);
      void utils.rooms.detectRoomsAiStatus.invalidate();
    },
    onError: (error) => {
      const message = error.message || "";
      if (/network error|failed to fetch|aborted|timeout/i.test(message)) {
        return;
      }
      setDetectError(message || "AI room detection failed");
      setDetectingRoomId(null);
    },
  });
  const detectStatus = api.rooms.detectRoomsAiStatus.useQuery(
    { floorId: selectedFloorId ?? "00000000-0000-0000-0000-000000000000" },
    {
      enabled: Boolean(selectedFloorId && (detectMode || detectingRoomId)),
      refetchInterval: (query) =>
        query.state.data?.status === "running" ? 1500 : false,
    },
  );

  useEffect(() => {
    const job = detectStatus.data;
    if (!job || (job.status !== "done" && job.status !== "error")) return;
    const key = `${job.status}:${job.startedAt}`;
    if (handledDetectJob.current === key) return;
    handledDetectJob.current = key;
    setDetectingRoomId(null);
    if (job.status === "done") {
      setDetectError(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
      return;
    }
    setDetectError(job.error || "AI room detection failed");
  }, [detectStatus.data, jobId, utils.rooms.getJobRooms]);

  const data = roomsQuery.data;
  const canManage = data?.canManage ?? false;
  const floors = data?.floors ?? [];
  const selectedFloor =
    floors.find((floor) => floor.id === selectedFloorId) ?? null;
  const selectedRoom =
    selectedFloor?.rooms.find((room) => room.id === selectedRoomId) ?? null;
  const isDetecting =
    detectRoomsAi.isPending || detectStatus.data?.status === "running";
  const canEditFloor = canManage && editMode;
  floorNameDraftRef.current = floorNameDraft;

  const persistFloorName = (floorId: string, currentName: string, draft: string) => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setFloorNameDraft(currentName);
      return;
    }
    if (trimmed === currentName) return;
    renameFloor.mutate({ floorId, name: trimmed });
  };

  const queueFloorRename = (floorId: string, currentName: string, draft: string) => {
    if (floorRenameTimer.current) clearTimeout(floorRenameTimer.current);
    floorRenameTimer.current = setTimeout(() => {
      persistFloorName(floorId, currentName, draft);
    }, 400);
  };

  const flushFloorRename = () => {
    if (floorRenameTimer.current) {
      clearTimeout(floorRenameTimer.current);
      floorRenameTimer.current = null;
    }
    if (!selectedFloor) return;
    persistFloorName(
      selectedFloor.id,
      selectedFloor.name,
      floorNameDraftRef.current,
    );
  };

  const closeFloorViewer = () => {
    flushFloorRename();
    setSelectedFloorId(null);
    setSelectedRoomId(null);
    setEditingRoomId(null);
    setCreateMode(false);
    setDetectMode(false);
    setDetectingRoomId(null);
    setVertexMode(null);
    setEditMode(false);
  };

  const exitEditMode = () => {
    flushFloorRename();
    setEditMode(false);
    setEditingRoomId(null);
    setCreateMode(false);
    setVertexMode(null);
  };

  const startDetect = () => {
    if (!selectedFloor || isDetecting) return;
    setDetectError(null);
    setDetectMode(false);
    setDetectingRoomId(selectedFloor.id);
    detectRoomsAi.mutate({
      floorId: selectedFloor.id,
    });
  };

  const handleUpload = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("jobId", jobId);
      body.set("file", file);
      const response = await fetch("/api/job-rooms/upload", {
        method: "POST",
        body,
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Upload failed");
      }
      setSelectedFloorId(null);
      setSelectedRoomId(null);
      await utils.rooms.getJobRooms.invalidate({ jobId });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (roomsQuery.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1].map((index) => (
          <Card key={index} className="animate-pulse">
            <CardHeader>
              <div className="h-6 w-2/3 rounded bg-gray-200" />
            </CardHeader>
            <CardContent>
              <div className="h-4 w-1/2 rounded bg-gray-200" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (selectedRoom && selectedFloor) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">
              {selectedRoom.name}
            </h2>
            <p className="text-muted-foreground text-sm">
              {selectedFloor.name}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setSelectedRoomId(null)}
          >
            Back to floor
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <DoorOpenIcon className="mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-semibold">Room options</h3>
            <p className="text-muted-foreground text-center">
              Options for this room will go here next.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">Rooms</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            {canManage
              ? "Upload a multi-page floor plan PDF. Each page becomes a floor."
              : "Pick a floor, then tap a room."}
          </p>
        </div>
        {canManage ? (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void handleUpload(file);
              }}
            />
            <Button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              size="lg"
              className="h-11 w-full sm:w-auto"
            >
              <UploadIcon className="mr-2 h-5 w-5" />
              {uploading
                ? "Processing PDF..."
                : data?.plan
                  ? "Replace PDF"
                  : "Upload PDF"}
            </Button>
          </>
        ) : null}
      </div>

      {uploadError ? (
        <p className="mb-4 text-sm text-red-600">{uploadError}</p>
      ) : null}
      {data?.plan?.status === "failed" ? (
        <p className="mb-4 text-sm text-red-600">{data.plan.error}</p>
      ) : null}

      {floors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <DoorOpenIcon className="mb-4 h-12 w-12 text-gray-400" />
            <h3 className="mb-2 text-lg font-semibold">No rooms yet</h3>
            <p className="text-muted-foreground text-center">
              {canManage
                ? "Upload the job’s architectural PDF to detect floors and rooms."
                : "No confirmed floors yet."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {floors.map((floor) => (
            <Card
              key={floor.id}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => {
                setSelectedFloorId(floor.id);
                setSelectedRoomId(null);
                setEditingRoomId(null);
                setCreateMode(false);
                setVertexMode(null);
                setEditMode(false);
                setFloorNameDraft(floor.name);
              }}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
                    {floor.name}
                  </CardTitle>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="-mt-3 -mr-3 h-10 w-10 shrink-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Delete floor ${floor.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setFloorToDelete({
                          id: floor.id,
                          name: floor.name,
                          roomCount: floor.rooms.length,
                        });
                      }}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-gray-600">
                  <div className="flex items-center gap-2">
                    <DoorOpenIcon className="h-4 w-4" />
                    <span>
                      {floor.rooms.length}{" "}
                      {floor.rooms.length === 1 ? "room" : "rooms"}
                    </span>
                  </div>
                  <div>
                    {floor.status === "confirmed" ? "Confirmed" : "Needs review"}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={!!selectedFloor && !selectedRoom}
        onOpenChange={(open) => {
          if (!open) closeFloorViewer();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex h-[96dvh] w-[96vw] max-h-[96dvh] max-w-none flex-col gap-3 overflow-hidden p-3 sm:max-w-none"
        >
          {selectedFloor ? (
            <>
              <DialogHeader className="shrink-0 space-y-2 text-left">
                <DialogTitle className="sr-only">
                  {selectedFloor.name}
                </DialogTitle>
                <div className="flex items-start gap-2">
                  <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    {canEditFloor ? (
                      <Input
                        value={floorNameDraft}
                        onChange={(event) => {
                          const name = event.target.value;
                          setFloorNameDraft(name);
                          queueFloorRename(
                            selectedFloor.id,
                            selectedFloor.name,
                            name,
                          );
                        }}
                        onBlur={flushFloorRename}
                        className="max-w-xs text-lg font-semibold"
                        aria-label="Floor name"
                      />
                    ) : (
                      <div className="text-lg font-semibold text-gray-900">
                        {selectedFloor.name}
                      </div>
                    )}
                    <p className="text-muted-foreground mt-1 text-sm">
                      {createMode
                        ? "Drag on the plan to draw a new room."
                        : vertexMode === "add"
                          ? "Tap the plan to add a vertex there."
                          : vertexMode === "delete"
                            ? "Tap a vertex to delete it."
                            : editingRoomId
                              ? "Drag corners to reshape. Use Add/Delete vertex for extra control."
                              : isDetecting
                                ? "Detecting rooms on this floor. Leave this screen open."
                              : editMode
                                ? "Tap a room to reshape it, or use the tools to add, detect, or delete rooms."
                              : canManage
                                ? "Pinch to zoom. Two fingers to scroll. Tap Edit to change rooms."
                                : "Pinch to zoom. Two fingers to scroll. Tap a room to open it."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {canManage && !editMode ? (
                      <Button onClick={() => setEditMode(true)}>
                        <PencilIcon className="mr-1 h-4 w-4" />
                        Edit
                      </Button>
                    ) : null}
                    {canEditFloor && editingRoomId ? (
                      <>
                        <Button
                          variant={vertexMode === "add" ? "default" : "outline"}
                          onClick={() =>
                            setVertexMode((value) =>
                              value === "add" ? null : "add",
                            )
                          }
                        >
                          Add vertex
                        </Button>
                        <Button
                          variant={vertexMode === "delete" ? "default" : "outline"}
                          onClick={() =>
                            setVertexMode((value) =>
                              value === "delete" ? null : "delete",
                            )
                          }
                        >
                          Delete vertex
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => {
                            if (!editingRoomId) return;
                            deleteRoom.mutate({ roomId: editingRoomId });
                          }}
                          disabled={deleteRoom.isPending}
                        >
                          Delete room
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEditingRoomId(null);
                            setVertexMode(null);
                            void utils.rooms.getJobRooms.invalidate({ jobId });
                          }}
                        >
                          Done
                        </Button>
                      </>
                    ) : null}
                    {canEditFloor && !editingRoomId ? (
                      <>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setCreateMode(false);
                            startDetect();
                          }}
                          disabled={isDetecting || createMode}
                        >
                          <SparklesIcon className="mr-1 h-4 w-4" />
                          {isDetecting ? "Detecting…" : "AI detect rooms"}
                        </Button>
                        <Button
                          variant={createMode ? "outline" : "default"}
                          onClick={() => {
                            setDetectMode(false);
                            setCreateMode((value) => !value);
                          }}
                          disabled={isDetecting}
                        >
                          {createMode ? "Cancel" : "New room"}
                        </Button>
                      </>
                    ) : null}
                    {canEditFloor ? (
                      <>
                        <Button
                          variant="destructive"
                          onClick={() =>
                            setRoomsToDelete({
                              floorId: selectedFloor.id,
                              floorName: selectedFloor.name,
                              roomCount: selectedFloor.rooms.length,
                            })
                          }
                          disabled={
                            selectedFloor.rooms.length === 0 ||
                            deleteAllRooms.isPending
                          }
                        >
                          Delete all rooms
                        </Button>
                        <Button variant="outline" onClick={exitEditMode}>
                          Done editing
                        </Button>
                      </>
                    ) : null}
                    {canManage && selectedFloor.status !== "confirmed" ? (
                      <Button
                        onClick={() =>
                          confirmFloor.mutate({ floorId: selectedFloor.id })
                        }
                      >
                        Confirm floor
                      </Button>
                    ) : null}
                  </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-full border-gray-300 bg-white shadow-sm"
                    aria-label="Close floor"
                    onClick={closeFloorViewer}
                  >
                    <XIcon className="h-5 w-5" />
                  </Button>
                </div>
              </DialogHeader>
              {detectError ? (
                <p className="shrink-0 px-1 text-sm text-red-600">{detectError}</p>
              ) : null}

              <div className="min-h-0 flex-1">
                <FloorPlanCanvas
                  imageUrl={selectedFloor.imageUrl}
                  rooms={selectedFloor.rooms.map((room) => ({
                    id: room.id,
                    name: room.name,
                    confirmed: room.confirmed,
                    shape: room.shape as FloorRoomShape,
                  }))}
                  selectedRoomId={selectedRoomId}
                  editingRoomId={editingRoomId}
                  detectingRoomId={null}
                  createMode={createMode}
                  detectMode={false}
                  vertexMode={vertexMode}
                  canEdit={canEditFloor}
                  onSelectRoom={(roomId) => {
                    if (editMode) {
                      setSelectedRoomId(null);
                      setEditingRoomId(roomId);
                      const room = selectedFloor.rooms.find(
                        (item) => item.id === roomId,
                      );
                      setRoomNameDraft(room?.name ?? "");
                      return;
                    }
                    if (editingRoomId) return;
                    const room = selectedFloor.rooms.find(
                      (item) => item.id === roomId,
                    );
                    setSelectedRoomId(roomId);
                    setRoomNameDraft(room?.name ?? "");
                  }}
                  onStartEdit={(roomId) => {
                    setSelectedRoomId(null);
                    setEditingRoomId(roomId);
                    const room = selectedFloor.rooms.find(
                      (item) => item.id === roomId,
                    );
                    setRoomNameDraft(room?.name ?? "");
                  }}
                  onCreateRoom={
                    canEditFloor && createMode
                      ? (shape) => {
                          setCreateMode(false);
                          addRoom.mutate({
                            floorId: selectedFloor.id,
                            name: "New room",
                            shape,
                          });
                        }
                      : undefined
                  }
                  onUpdateShape={
                    canEditFloor
                      ? (roomId, shape) =>
                          updateRoom.mutate({ roomId, shape })
                      : undefined
                  }
                />
              </div>

              {selectedFloor.rooms.length > 0 ? (
                <div className="shrink-0 border-t bg-gray-50">
                  <button
                    type="button"
                    onClick={() => setIsRoomListOpen((open) => !open)}
                    className="flex w-full items-center justify-between gap-2 px-2 py-3 text-left sm:px-3"
                  >
                    <div className="text-sm font-semibold">
                      Units highlighted ({selectedFloor.rooms.length})
                    </div>
                    {isRoomListOpen ? (
                      <ChevronDown className="h-4 w-4 shrink-0 text-gray-500" />
                    ) : (
                      <ChevronUp className="h-4 w-4 shrink-0 text-gray-500" />
                    )}
                  </button>
                  <div
                    className={`grid transition-all duration-200 ease-out ${
                      isRoomListOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      <div className="max-h-32 overflow-y-auto overscroll-contain border-t px-2 py-2 sm:px-3">
                        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                          {selectedFloor.rooms.map((room, index) => {
                            const color = getRoomColor(index);
                            return (
                              <button
                                key={room.id}
                                type="button"
                                className="flex items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-white"
                                onClick={() => {
                                  if (editMode) {
                                    setSelectedRoomId(null);
                                    setEditingRoomId(room.id);
                                    setRoomNameDraft(room.name);
                                    return;
                                  }
                                  setSelectedRoomId(room.id);
                                  setRoomNameDraft(room.name);
                                }}
                              >
                                <span
                                  className="h-3 w-3 shrink-0 rounded-sm border"
                                  style={{
                                    backgroundColor: color.swatch,
                                    borderColor: color.border,
                                  }}
                                />
                                <span className="truncate">{room.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {canEditFloor && selectedRoomId ? (
                <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                  <Input
                    value={roomNameDraft}
                    onChange={(event) => setRoomNameDraft(event.target.value)}
                  />
                  <Button
                    onClick={() =>
                      updateRoom.mutate({
                        roomId: selectedRoomId,
                        name: roomNameDraft.trim() || "Room",
                      })
                    }
                  >
                    <PencilIcon className="mr-2 h-4 w-4" />
                    Rename
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() =>
                      deleteRoom.mutate({ roomId: selectedRoomId })
                    }
                  >
                    <TrashIcon className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!floorToDelete}
        onOpenChange={(open) => {
          if (!open) setFloorToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete floor?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              {floorToDelete ? `"${floorToDelete.name}"` : "this floor"}
              {floorToDelete?.roomCount
                ? ` and ${floorToDelete.roomCount} ${
                    floorToDelete.roomCount === 1 ? "room" : "rooms"
                  }`
                : ""}
              . This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setFloorToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!floorToDelete || deleteFloor.isPending}
              onClick={() => {
                if (!floorToDelete) return;
                deleteFloor.mutate({ floorId: floorToDelete.id });
              }}
            >
              Delete Floor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!roomsToDelete}
        onOpenChange={(open) => {
          if (!open) setRoomsToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all rooms?</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              {roomsToDelete?.roomCount
                ? `${roomsToDelete.roomCount} ${
                    roomsToDelete.roomCount === 1 ? "room" : "rooms"
                  }`
                : "all rooms"}
              {roomsToDelete ? ` on "${roomsToDelete.floorName}"` : ""}
              . The floor itself will stay. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRoomsToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!roomsToDelete || deleteAllRooms.isPending}
              onClick={() => {
                if (!roomsToDelete) return;
                deleteAllRooms.mutate({ floorId: roomsToDelete.floorId });
              }}
            >
              Delete all rooms
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
