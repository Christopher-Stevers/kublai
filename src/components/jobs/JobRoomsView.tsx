"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  DoorOpenIcon,
  Loader2Icon,
  PencilIcon,
  SparklesIcon,
  TrashIcon,
  UploadIcon,
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
import { uploadDrawings } from "~/lib/upload-drawings";
import { shapeBBox, toPolygon } from "~/lib/room-shape";
import { api } from "~/trpc/react";
import { confirmAction } from "~/components/ui/app-dialogs";

export function JobRoomsView({ jobId }: { jobId: string }) {
  const roomEditVersions = useRef(new Map<string, number>());
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [completenessChecked, setCompletenessChecked] = useState(false);
  const [reviewReason, setReviewReason] = useState<
    "not-space" | "boundary" | "merged" | "split" | "duplicate" | "unspecified"
  >("unspecified");
  const [reviewRoomId, setReviewRoomId] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [detectMode, setDetectMode] = useState(false);
  const [detectingRoomId, setDetectingRoomId] = useState<string | null>(null);
  const [traceMode, setTraceMode] = useState<"include" | "exclude">("include");
  const [traceInclude, setTraceInclude] = useState<{ x: number; y: number }[]>(
    [],
  );
  const [traceExclude, setTraceExclude] = useState<{ x: number; y: number }[]>(
    [],
  );
  const [tracePreview, setTracePreview] = useState<FloorRoomShape | null>(null);
  const [traceRoomId, setTraceRoomId] = useState<string | null>(null);
  const [vertexMode, setVertexMode] = useState<"add" | "delete" | null>(null);
  const handledDetectJob = useRef("");
  const floorRenameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floorNameDraftRef = useRef("");
  const [isRoomListOpen, setIsRoomListOpen] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingSheets, setPendingSheets] = useState<
    { id: string; name: string; imageUrl: string }[]
  >([]);
  const [keepSheetIds, setKeepSheetIds] = useState<Record<string, boolean>>({});
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
    onError: (error) => setDetectError(error.message),
  });
  const reviewRoom = api.rooms.reviewRoom.useMutation({
    onSuccess: async (_, variables) => {
      await utils.rooms.getJobRooms.invalidate({ jobId });
      const floor = utils.rooms.getJobRooms
        .getData({ jobId })
        ?.floors.find((f) => f.id === selectedFloorId);
      setReviewRoomId(
        floor?.rooms
          .filter(
            (r) => r.id !== variables.roomId && r.reviewStatus === "pending",
          )
          .sort(
            (a, b) =>
              (b.reviewPriority?.priority ?? 0.5) -
              (a.reviewPriority?.priority ?? 0.5),
          )[0]?.id ?? null,
      );
    },
    onError: (error) =>
      setDetectError(`Review could not be saved: ${error.message}`),
  });
  const addRoom = api.rooms.addRoom.useMutation({
    onSuccess: async (room) => {
      await utils.rooms.getJobRooms.invalidate({ jobId });
      if (room?.id) {
        setSelectedRoomId(null);
        setEditingRoomId(room.id);
        setRoomNameDraft(room.name);
        roomEditVersions.current.set(room.id, room.updatedAt.getTime());
      }
    },
    onError: (error) =>
      setDetectError(`Room could not be added: ${error.message}`),
  });
  const [failedRoomUpdate, setFailedRoomUpdate] = useState<Parameters<typeof utils.client.rooms.updateRoom.mutate>[0] | null>(null);
  const [roomUpdateConflict, setRoomUpdateConflict] = useState(false);
  const updateRoom = api.rooms.updateRoom.useMutation({
    scope: { id: `room-edits-${jobId}` },
    onSuccess: async (result, variables) => {
      roomEditVersions.current.set(variables.roomId, result.updatedAt);
      setFailedRoomUpdate(null);
      setRoomUpdateConflict(false);
      setDetectError(null);
      await utils.rooms.getJobRooms.invalidate({ jobId });
      const room = utils.rooms.getJobRooms
        .getData({ jobId })
        ?.floors.flatMap((floor) => floor.rooms)
        .find((room) => room.id === variables.roomId);
      if (room?.updatedAt.getTime() !== result.updatedAt) {
        setFailedRoomUpdate(variables);
        setRoomUpdateConflict(true);
        setDetectError("This outline changed again. Reload the latest outline before editing.");
      }
    },
    onError: (error, variables) => {
      setFailedRoomUpdate(variables);
      setRoomUpdateConflict(error.data?.code === "CONFLICT");
      setDetectError(`Room changes could not be saved: ${error.message}`);
    },
  });
  const growRoom = api.rooms.growRoom.useMutation({
    onSuccess: (result) => {
      setTracePreview(result.shape);
      setDetectError(null);
    },
    onError: (error) => setDetectError(error.message),
  });
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
      setReviewMode(false);
      setReviewRoomId(null);
      setSelectedRoomId(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
    },
  });
  const confirmDrawingUpload = api.rooms.confirmDrawingUpload.useMutation();
  const detectRooms = api.rooms.detectRooms.useMutation({
    onSuccess: () => {
      setDetectError(null);
      void utils.rooms.detectRoomsStatus.invalidate();
    },
    onError: (error) => {
      const message = error.message || "";
      if (
        /network error|failed to fetch|aborted|timeout|returned http|content type/i.test(
          message,
        )
      ) {
        setDetectError(
          `${message || "Lost contact with ForemenHQ"}. Checking detection status…`,
        );
        void utils.rooms.detectRoomsStatus.invalidate();
        return;
      }
      setDetectError(message || "Room detection failed");
      setDetectingRoomId(null);
    },
  });
  const detectStatus = api.rooms.detectRoomsStatus.useQuery(
    { floorId: selectedFloorId ?? "00000000-0000-0000-0000-000000000000" },
    {
      // A completed cached run can clear local launch state before the new
      // worker responds. Status belongs to the selected floor, not that state.
      enabled: Boolean(selectedFloorId && roomsQuery.data?.canManage),
      refetchInterval: (query) =>
        query.state.data?.status === "running" || detectRooms.isPending || detectingRoomId === selectedFloorId
          ? 1000
          : 5000,
    },
  );

  useEffect(() => {
    const job = detectStatus.data;
    if (detectRooms.isPending || !job || (job.status !== "done" && job.status !== "error")) return;
    const key = `${job.status}:${job.startedAt}`;
    if (handledDetectJob.current === key) return;
    handledDetectJob.current = key;
    setDetectingRoomId(null);
    if (job.status === "done") {
      setDetectError(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
      return;
    }
    setDetectError(job.error || "Room detection failed");
  }, [
    detectStatus.data,
    detectRooms.isPending,
    jobId,
    utils.rooms.getJobRooms,
  ]);

  const data = roomsQuery.data;
  const canManage = data?.canManage ?? false;
  const floors = (data?.floors ?? []).map((floor) => ({
    ...floor,
    rooms: floor.rooms.filter(
      (room) =>
        room.reviewStatus !== "superseded" &&
        (showRejected || room.reviewStatus !== "rejected"),
    ),
  }));
  const selectedFloor =
    floors.find((floor) => floor.id === selectedFloorId) ?? null;
  const selectedRoom =
    selectedFloor?.rooms.find((room) => room.id === selectedRoomId) ?? null;
  const reviewedRoom =
    selectedFloor?.rooms.find((room) => room.id === reviewRoomId) ?? null;
  useEffect(() => {
    setCompletenessChecked(false);
  }, [selectedFloorId, selectedFloor?.updatedAt.getTime()]);
  useEffect(() => {
    setReviewReason("unspecified");
  }, [reviewRoomId]);
  const pendingReview =
    selectedFloor?.rooms
      .filter((room) => room.reviewStatus === "pending")
      .sort(
        (a, b) =>
          (b.reviewPriority?.priority ?? 0.5) -
          (a.reviewPriority?.priority ?? 0.5),
      ) ?? [];
  const isDetecting =
    detectRooms.isPending || detectStatus.data?.status === "running";
  const detectLog = detectStatus.data?.log ?? [];
  const currentDetectMessage =
    detectLog.at(-1)?.message ??
    (isDetecting ? "Starting room detection…" : null);
  const detectHistory = detectLog.slice(-8, -1);
  const canEditFloor = canManage && editMode;
  floorNameDraftRef.current = floorNameDraft;

  const persistFloorName = (
    floorId: string,
    currentName: string,
    draft: string,
  ) => {
    const trimmed = draft.trim();
    if (!trimmed) {
      setFloorNameDraft(currentName);
      return;
    }
    if (trimmed === currentName) return;
    renameFloor.mutate({ floorId, name: trimmed });
  };

  const queueFloorRename = (
    floorId: string,
    currentName: string,
    draft: string,
  ) => {
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
    setTraceInclude([]);
    setTraceExclude([]);
    setTracePreview(null);
    setTraceRoomId(null);
    setVertexMode(null);
    setEditMode(false);
  };

  const exitEditMode = () => {
    flushFloorRename();
    setEditMode(false);
    setEditingRoomId(null);
    setCreateMode(false);
    setVertexMode(null);
    setDetectMode(false);
    setTraceInclude([]);
    setTraceExclude([]);
    setTracePreview(null);
    setTraceRoomId(null);
  };

  const startDetect = (
    method: "standard" | "hybrid" | "complete" = "complete",
  ) => {
    if (!selectedFloor || isDetecting) return;
    setDetectError(null);
    setDetectMode(false);
    setDetectingRoomId(selectedFloor.id);
    if (method === "complete") {
      setReviewMode(true);
      setReviewRoomId(null);
    }
    detectRooms.mutate({
      floorId: selectedFloor.id,
      method,
    });
  };

  const resetTrace = () => {
    setDetectMode(false);
    setTraceMode("include");
    setTraceInclude([]);
    setTraceExclude([]);
    setTracePreview(null);
    setTraceRoomId(null);
  };

  const requestTrace = (
    include: { x: number; y: number }[],
    exclude: { x: number; y: number }[],
    roomId = traceRoomId,
  ) => {
    if (!selectedFloor || include.length === 0) return;
    growRoom.mutate({
      floorId: selectedFloor.id,
      roomId: roomId ?? undefined,
      include,
      exclude,
    });
  };

  const startTrace = (roomId?: string) => {
    if (!selectedFloor) return;
    const room = roomId
      ? selectedFloor.rooms.find((candidate) => candidate.id === roomId)
      : null;
    if (room) roomEditVersions.current.set(room.id, room.updatedAt.getTime());
    const shape = room?.shape as FloorRoomShape | undefined;
    const polygon = shape ? toPolygon(shape) : null;
    const box = polygon ? shapeBBox(polygon) : null;
    const include = box ? [{ x: box.x + box.w / 2, y: box.y + box.h / 2 }] : [];
    setEditingRoomId(null);
    setSelectedRoomId(null);
    setCreateMode(false);
    setDetectMode(true);
    setTraceMode("include");
    setTraceRoomId(roomId ?? null);
    setTraceInclude(include);
    setTraceExclude([]);
    setTracePreview(shape ?? null);
    if (include.length) requestTrace(include, [], roomId ?? null);
  };

  const addTracePoint = (point: { x: number; y: number }) => {
    if (traceMode === "exclude") {
      const exclude = [...traceExclude, point];
      setTraceExclude(exclude);
      requestTrace(traceInclude, exclude);
      return;
    }
    const include = [...traceInclude, point];
    setTraceInclude(include);
    requestTrace(include, traceExclude);
  };

  const undoTracePoint = () => {
    if (traceMode === "exclude" && traceExclude.length) {
      const exclude = traceExclude.slice(0, -1);
      setTraceExclude(exclude);
      requestTrace(traceInclude, exclude);
      return;
    }
    if (traceInclude.length <= 1) return;
    const include = traceInclude.slice(0, -1);
    setTraceInclude(include);
    requestTrace(include, traceExclude);
  };

  const saveTrace = () => {
    if (!selectedFloor || !tracePreview) return;
    if (traceRoomId) {
      updateRoom.mutate(
        {
          roomId: traceRoomId,
          shape: tracePreview,
          expectedUpdatedAt: roomEditVersions.current.get(traceRoomId),
        },
        {
          onSuccess: resetTrace,
        },
      );
      return;
    }
    addRoom.mutate(
      { floorId: selectedFloor.id, name: "New room", shape: tracePreview },
      { onSuccess: resetTrace },
    );
  };

  const handleUpload = async (file: File) => {
    setUploadError(null);
    setUploading(true);
    try {
      const sheets = await uploadDrawings(jobId, file);
      setPendingSheets(sheets);
      setKeepSheetIds(
        Object.fromEntries(sheets.map((sheet) => [sheet.id, true])),
      );
      setSelectedFloorId(null);
      setSelectedRoomId(null);
      await utils.rooms.getJobRooms.invalidate({ jobId });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const confirmPendingSheets = async () => {
    const keepFloorIds = pendingSheets
      .filter((sheet) => keepSheetIds[sheet.id] !== false)
      .map((sheet) => sheet.id);
    setUploadError(null);
    try {
      const result = await confirmDrawingUpload.mutateAsync({
        jobId,
        keepFloorIds,
      });
      setPendingSheets([]);
      setKeepSheetIds({});
      await utils.rooms.getJobRooms.invalidate({ jobId });
      for (const floorId of result.keptFloorIds) {
        detectRooms.mutate({ floorId });
      }
      if (result.keptFloorIds[0]) {
        setSelectedFloorId(result.keptFloorIds[0]);
        setDetectingRoomId(result.keptFloorIds[0]);
        setEditMode(true);
      }
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Could not save drawings",
      );
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
            <h2 className="text-foreground text-xl font-semibold">
              {selectedRoom.name}
            </h2>
            <p className="text-muted-foreground text-sm">
              {selectedFloor.name}
            </p>
          </div>
          <Button variant="outline" onClick={() => setSelectedRoomId(null)}>
            Back to floor
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <DoorOpenIcon className="text-muted-foreground/70 mb-4 h-12 w-12" />
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
      {!selectedFloor ? (
        <>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-foreground text-xl font-semibold">Rooms</h2>
              <p className="text-muted-foreground mt-1 text-sm">
            {canManage
              ? "Upload drawings (up to 100 pages, 100 MB per PDF). Review each sheet, then rooms are detected on the ones you keep."
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
                : data?.plan || floors.length > 0
                  ? "Upload additional drawings"
                  : "Upload drawings"}
            </Button>
          </>
        ) : null}
          </div>

          {uploadError ? (
            <p className="mb-4 text-sm text-red-600">{uploadError}</p>
          ) : null}

          <Dialog open={pendingSheets.length > 0}>
            <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
              <DialogHeader>
            <DialogTitle>Review uploaded drawings</DialogTitle>
            <DialogDescription>
              Keep or discard each sheet. Rooms are detected only after you
              confirm.
            </DialogDescription>
          </DialogHeader>
              <div className="grid gap-4 sm:grid-cols-2">
                {pendingSheets.map((sheet) => {
                  const keep = keepSheetIds[sheet.id] !== false;
                  return (
                    <div
                      key={sheet.id}
                  className={`overflow-hidden rounded-lg border ${
                    keep ? "border-blue-500" : "border-border opacity-60"
                  }`}
                    >
                      <img
                        src={sheet.imageUrl}
                        alt={sheet.name}
                        className="bg-muted h-40 w-full object-contain"
                      />
                      <div className="flex items-center justify-between gap-2 p-3">
                    <span className="text-sm font-medium">{sheet.name}</span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant={keep ? "default" : "outline"}
                        onClick={() =>
                          setKeepSheetIds((current) => ({
                            ...current,
                            [sheet.id]: true,
                          }))
                        }
                      >
                        Keep
                      </Button>
                      <Button
                        size="sm"
                        variant={!keep ? "default" : "outline"}
                        onClick={() =>
                          setKeepSheetIds((current) => ({
                            ...current,
                            [sheet.id]: false,
                          }))
                        }
                      >
                        Discard
                      </Button>
                    </div>
                  </div>
                    </div>
                  );
                })}
              </div>
              <DialogFooter>
            <Button
              onClick={() => void confirmPendingSheets()}
              disabled={confirmDrawingUpload.isPending}
            >
              {confirmDrawingUpload.isPending ? "Saving..." : "Confirm sheets"}
            </Button>
          </DialogFooter>
            </DialogContent>
          </Dialog>
          {data?.plan?.status === "failed" ? (
        <p className="mb-4 text-sm text-red-600">{data.plan.error}</p>
      ) : null}

          {floors.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <DoorOpenIcon className="text-muted-foreground/70 mb-4 h-12 w-12" />
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
                    setReviewRoomId(null);
                    setReviewMode(false);
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
                    <div className="text-muted-foreground space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                    <DoorOpenIcon className="h-4 w-4" />
                    <span>
                      {floor.rooms.length}{" "}
                      {floor.rooms.length === 1 ? "room" : "rooms"}
                    </span>
                  </div>
                      <div>
                    {floor.status === "confirmed"
                      ? "Confirmed"
                      : "Needs review"}
                  </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}

      {selectedFloor ? (
        <div className="flex min-h-[70dvh] flex-col gap-3">
          <div className="shrink-0 space-y-2">
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
                    <div className="text-foreground text-lg font-semibold">
                      {selectedFloor.name}
                    </div>
                  )}
                  <p className="text-muted-foreground mt-1 text-sm">
                        {createMode
                          ? "Drag on the plan to draw a new room."
                          : detectMode
                            ? traceMode === "include"
                              ? "Tap inside every part that belongs to the room. Switch to Exclude to carve away mistakes."
                              : "Tap regions that do not belong to the room, then save the preview."
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
                  {canManage ? (
                    <Button
                      variant={reviewMode ? "default" : "outline"}
                      onClick={() => {
                        setReviewMode((value) => !value);
                        setEditMode(false);
                        setEditingRoomId(null);
                        setCreateMode(false);
                        setVertexMode(null);
                        resetTrace();
                        setSelectedRoomId(null);
                        setReviewRoomId(
                          pendingReview[0]?.id ??
                            selectedFloor.rooms[0]?.id ??
                            null,
                        );
                      }}
                    >
                      Review detections ({pendingReview.length})
                    </Button>
                  ) : null}
                  {canManage && !editMode ? (
                    <Button
                      onClick={() => {
                        setReviewMode(false);
                        setEditMode(true);
                      }}
                    >
                      <PencilIcon className="mr-1 h-4 w-4" />
                      Edit
                    </Button>
                  ) : null}
                  {canEditFloor && detectMode ? (
                        <>
                          <Button
                            variant={
                              traceMode === "include" ? "default" : "outline"
                            }
                            onClick={() => setTraceMode("include")}
                          >
                            + Include
                          </Button>
                          <Button
                            variant={
                              traceMode === "exclude" ? "default" : "outline"
                            }
                            onClick={() => setTraceMode("exclude")}
                            disabled={traceInclude.length === 0}
                          >
                            − Exclude
                          </Button>
                          <Button
                            variant="outline"
                            onClick={undoTracePoint}
                            disabled={
                              traceMode === "exclude"
                                ? traceExclude.length === 0
                                : traceInclude.length <= 1
                            }
                          >
                            Undo point
                          </Button>
                          <Button
                            onClick={saveTrace}
                            disabled={!tracePreview || growRoom.isPending || updateRoom.isPending}
                          >
                            Save trace
                          </Button>
                          <Button variant="outline" onClick={resetTrace}>
                            Cancel
                          </Button>
                        </>
                      ) : null}
                  {canEditFloor && editingRoomId && !detectMode ? (
                        <>
                          <Button
                            variant="outline"
                            disabled={updateRoom.isPending}
                            onClick={() => startTrace(editingRoomId)}
                          >
                            Auto trace
                          </Button>
                          <Button
                            variant={
                              vertexMode === "add" ? "default" : "outline"
                            }
                            disabled={updateRoom.isPending}
                            onClick={() =>
                              setVertexMode((value) =>
                                value === "add" ? null : "add",
                              )
                            }
                          >
                            Add vertex
                          </Button>
                          <Button
                            variant={
                              vertexMode === "delete" ? "default" : "outline"
                            }
                            disabled={updateRoom.isPending}
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
                              void utils.rooms.getJobRooms.invalidate({
                                jobId,
                              });
                            }}
                          >
                            Done
                          </Button>
                        </>
                      ) : null}
                  {canEditFloor && !editingRoomId && !detectMode ? (
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
                        {isDetecting ? "Detecting…" : "Detect rooms"}
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
                      <Button
                            variant="outline"
                            onClick={() => startTrace()}
                            disabled={isDetecting}
                          >
                            Trace room
                          </Button>
                    </>
                  ) : null}
                  {canEditFloor && !detectMode ? (
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
                          deleteAllRooms.isPending ||
                          isDetecting
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
                      disabled={
                        !completenessChecked ||
                        pendingReview.length > 0 ||
                        isDetecting ||
                        confirmFloor.isPending
                      }
                      onClick={() =>
                        confirmFloor.mutate({
                          floorId: selectedFloor.id,
                          completenessChecked,
                        })
                      }
                    >
                      Confirm reviewed floor
                    </Button>
                  ) : null}
                </div>
              </div>
              <Button
                    type="button"
                    variant="outline"
                    onClick={closeFloorViewer}
                  >
                    Back to rooms
                  </Button>
            </div>
          </div>
          {detectError ? (
            <p className="shrink-0 px-1 text-sm text-red-600">
              {detectError}
              {failedRoomUpdate ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-2"
                  disabled={updateRoom.isPending}
                  onClick={async () => {
                    if (!roomUpdateConflict) {
                      updateRoom.mutate(failedRoomUpdate);
                      return;
                    }
                    await utils.rooms.getJobRooms.invalidate({ jobId });
                    roomEditVersions.current.delete(failedRoomUpdate.roomId);
                    setEditingRoomId(null);
                    setTracePreview(null);
                    setTraceRoomId(null);
                    setFailedRoomUpdate(null);
                    setRoomUpdateConflict(false);
                    setDetectError(null);
                  }}
                >
                  {roomUpdateConflict ? "Reload latest outline" : "Retry save"}
                </Button>
              ) : null}
            </p>
          ) : null}
          {updateRoom.isPending ? (
            <p role="status" className="text-muted-foreground shrink-0 px-1 text-sm">Saving outline…</p>
          ) : null}
          {currentDetectMessage ? (
            <div className="max-h-36 shrink-0 overflow-y-auto rounded-md border bg-slate-950 font-mono text-xs text-slate-100">
              <div className="sticky top-0 z-10 flex items-start gap-2 border-b border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-emerald-300">
                    {isDetecting ? (
                      <Loader2Icon className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    ) : null}
                    <span>{currentDetectMessage}</span>
                  </div>
              {detectHistory.length > 0 ? (
                <div className="px-3 py-2 text-slate-300">
                  {detectHistory.map((entry) => (
                    <div key={`${entry.at}-${entry.message}`}>
                      {entry.message}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {canManage && reviewMode ? (
            <div
              className="bg-background shrink-0 rounded-md border p-3"
              aria-label="Detection review"
            >
              <div className="flex items-center justify-between gap-2">
                <strong>
                  {reviewedRoom?.name ??
                    (pendingReview.length
                      ? "Tap an outline to review it"
                      : "All current detections reviewed")}
                </strong>
                <span className="text-muted-foreground text-xs">
                  {pendingReview.length} remaining
                </span>
              </div>
              <p className="text-muted-foreground my-1 text-xs">
                Approve the boundary only when it matches the drawing. Your
                feedback is saved with this drawing so unchanged mistakes are
                not proposed again.
              </p>
              {(reviewedRoom?.detection as { invalidGeometry?: boolean } | null)
                ?.invalidGeometry ? (
                <p className="text-destructive my-1 text-xs">
                  This boundary crosses itself. Use Fix outline before approving
                  it.
                </p>
              ) : null}
              {reviewedRoom ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={reviewRoom.isPending}
                    onClick={() =>
                      reviewRoom.mutate({
                        roomId: reviewedRoom.id,
                        decision: "approved",
                        expectedUpdatedAt: reviewedRoom.updatedAt.getTime(),
                      })
                    }
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={reviewRoom.isPending}
                    onClick={() =>
                      reviewRoom.mutate({
                        roomId: reviewedRoom.id,
                        decision: "rejected",
                        reason: reviewReason,
                        expectedUpdatedAt: reviewedRoom.updatedAt.getTime(),
                      })
                    }
                  >
                    Disapprove
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReviewMode(false);
                      setEditMode(true);
                      setEditingRoomId(reviewedRoom.id);
                      roomEditVersions.current.set(
                        reviewedRoom.id,
                        reviewedRoom.updatedAt.getTime(),
                      );
                      setRoomNameDraft(reviewedRoom.name);
                    }}
                  >
                    Fix outline
                  </Button>
                  {reviewedRoom.reviewStatus !== "pending" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={reviewRoom.isPending}
                      onClick={() =>
                        reviewRoom.mutate({
                          roomId: reviewedRoom.id,
                          decision: "pending",
                          expectedUpdatedAt: reviewedRoom.updatedAt.getTime(),
                        })
                      }
                    >
                      Undo review
                    </Button>
                  ) : null}
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  aria-label="Disapproval reason"
                  value={reviewReason}
                  onChange={(event) =>
                    setReviewReason(event.target.value as typeof reviewReason)
                  }
                  className="bg-background rounded-md border p-2 text-xs"
                >
                  <option value="unspecified">
                    Disapproval reason (optional)
                  </option>
                  <option value="not-space">Not a usable space</option>
                  <option value="boundary">Boundary needs fixing</option>
                  <option value="merged">Combines multiple rooms</option>
                  <option value="split">Only part of one room</option>
                  <option value="duplicate">Duplicate room</option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isDetecting}
                  onClick={() => {
                    setReviewMode(false);
                    setEditMode(true);
                    setCreateMode(true);
                  }}
                >
                  Add missing room
                </Button>
              </div>
              <label className="mt-2 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={completenessChecked}
                  disabled={pendingReview.length > 0 || isDetecting}
                  onChange={(event) =>
                    setCompletenessChecked(event.target.checked)
                  }
                />
                I checked the entire floor and added any missing rooms and
                hallways.
              </label>
              <label className="mt-2 flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={showRejected}
                  onChange={(event) => setShowRejected(event.target.checked)}
                />
                Show disapproved outlines
              </label>
            </div>
          ) : null}

          <div className="min-h-0 flex-1">
            <FloorPlanCanvas
              imageUrl={selectedFloor.imageUrl}
              rooms={selectedFloor.rooms.map((room) => ({
                id: room.id,
                name: room.name,
                confirmed: room.confirmed,
                reviewStatus: room.reviewStatus,
                shape: room.shape as FloorRoomShape,
              }))}
              previewShape={tracePreview}
              tracePoints={[
                    ...traceInclude.map((point) => ({
                      ...point,
                      kind: "include" as const,
                    })),
                    ...traceExclude.map((point) => ({
                      ...point,
                      kind: "exclude" as const,
                    })),
                  ]}
              selectedRoomId={reviewMode ? reviewRoomId : selectedRoomId}
              editingRoomId={editingRoomId}
              detectingRoomId={null}
              createMode={createMode}
              detectMode={detectMode}
              vertexMode={vertexMode}
              canEdit={canEditFloor && !updateRoom.isPending}
              onSelectRoom={(roomId) => {
                if (updateRoom.isPending && editMode) return;
                if (reviewMode) {
                  setReviewRoomId(roomId);
                  return;
                }
                if (editMode) {
                  if (editingRoomId === roomId) return;
                  setSelectedRoomId(null);
                  setEditingRoomId(roomId);
                  const room = selectedFloor.rooms.find(
                      (item) => item.id === roomId,
                    );
                  if (room)
                    roomEditVersions.current.set(
                      room.id,
                      room.updatedAt.getTime(),
                    );
                  setRoomNameDraft(room?.name ?? "");
                  return;
                }
                if (editingRoomId) return;
                const room = selectedFloor.rooms.find(
                      (item) => item.id === roomId,
                    );
                setSelectedRoomId(roomId);
                if (room)
                  roomEditVersions.current.set(
                    room.id,
                    room.updatedAt.getTime(),
                  );
                setRoomNameDraft(room?.name ?? "");
              }}
              onStartEdit={(roomId) => {
                if (updateRoom.isPending) return;
                setSelectedRoomId(null);
                setEditingRoomId(roomId);
                const room = selectedFloor.rooms.find(
                      (item) => item.id === roomId,
                    );
                if (room)
                  roomEditVersions.current.set(
                    room.id,
                    room.updatedAt.getTime(),
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
              onDetectAtPoint={
                    canEditFloor && detectMode ? addTracePoint : undefined
                  }
              onUpdateShape={
                canEditFloor && !updateRoom.isPending
                  ? (roomId, shape) =>
                      updateRoom.mutate({
                        roomId,
                        shape,
                        expectedUpdatedAt: roomEditVersions.current.get(roomId),
                      })
                  : undefined
              }
            />
          </div>

          {selectedFloor.rooms.length > 0 ? (
            <div className="bg-muted/50 shrink-0 border-t">
              <button
                    type="button"
                    onClick={() => setIsRoomListOpen((open) => !open)}
                    className="flex w-full items-center justify-between gap-2 px-2 py-3 text-left sm:px-3"
                  >
                <div className="text-sm font-semibold">
                  Spaces highlighted ({selectedFloor.rooms.length})
                </div>
                {isRoomListOpen ? (
                  <ChevronDown className="text-muted-foreground h-4 w-4 shrink-0" />
                ) : (
                  <ChevronUp className="text-muted-foreground h-4 w-4 shrink-0" />
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
                            disabled={updateRoom.isPending && editMode}
                            className="hover:bg-card flex items-center gap-2 rounded px-1 py-0.5 text-left text-sm"
                            onClick={() => {
                              if (reviewMode) {
                                setReviewRoomId(room.id);
                                return;
                              }
                              if (editMode) {
                                    if (editingRoomId === room.id) return;
                                    setSelectedRoomId(null);
                                    setEditingRoomId(room.id);
                                    roomEditVersions.current.set(
                                      room.id,
                                      room.updatedAt.getTime(),
                                    );
                                    setRoomNameDraft(room.name);
                                    return;
                                  }
                              setSelectedRoomId(room.id);
                              roomEditVersions.current.set(
                                room.id,
                                room.updatedAt.getTime(),
                              );
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
                disabled={updateRoom.isPending}
                onClick={() =>
                  updateRoom.mutate({
                    roomId: selectedRoomId,
                    expectedUpdatedAt:
                      roomEditVersions.current.get(selectedRoomId),
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
        </div>
      ) : null}

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
              {roomsToDelete ? ` on "${roomsToDelete.floorName}"` : ""}. The
              floor itself will stay. This action cannot be undone.
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
