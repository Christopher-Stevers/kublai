"use client";
import { SheetOfflineButton } from "./SheetOfflineButton";
import { useDrawingSnapshot } from "./useDrawingSnapshot";
import { useDrawingAccount } from "./DrawingAccountProvider";
import { usePageViewState } from "~/hooks/use-page-view-state";

import {
  CopyIcon,
  DoorOpenIcon,
  ListIcon,
  Loader2Icon,
  MoreVerticalIcon,
  PencilIcon,
  SparklesIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { RoomDetails, type RoomNotesDraft } from "./RoomDetails";

import { useDrawingCapabilities } from "~/components/permissions/DrawingsAccess";
import { notify } from "~/components/ui/app-dialogs";
import { PageHeader } from "~/components/ui/page-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { Input } from "~/components/ui/input";
import { useHeaderBackOverride } from "~/lib/header-back-events";
import { getRoomColor } from "~/lib/room-colors";
import { roomLabelPoint, toPolygon } from "~/lib/room-shape";
import { api } from "~/trpc/react";
import { FloorPlanCanvas, type FloorRoomShape } from "./FloorPlanCanvas";
import { RoomDrawingPicker } from "./RoomDrawingPicker";
import { useRoomTracePreview } from "./useRoomTracePreview";

type DetectionProgress = {
  status: string;
  queuePosition?: number | null;
  error?: string | null;
};

function detectionBusy(detection: DetectionProgress | null | undefined) {
  return detection?.status === "queued" || detection?.status === "running";
}

function detectionMessage(detection: DetectionProgress | null | undefined) {
  if (detection?.status === "queued") {
    return detection.queuePosition && detection.queuePosition > 0
      ? `Queued · position ${detection.queuePosition}`
      : "Queued for room detection";
  }
  if (detection?.status === "running") return "Detecting rooms…";
  if (detection?.status === "error")
    return detection.error
      ? `Detection failed: ${detection.error}`
      : "Room detection failed";
  return null;
}

export function JobRoomsView({
  jobId,
  onOpenMaterialList,
  onOpenDrawings,
}: {
  jobId: string;
  onOpenMaterialList?: (id: string) => void;
  onOpenDrawings?: () => void;
}) {
  const router = useRouter();
  const sandbox = useTutorialSandbox();
  const [notesDrafts, setNotesDrafts] = useState<
    Record<string, RoomNotesDraft | undefined>
  >({});
  const roomEditVersions = useRef(new Map<string, number>());
  const [selectedFloorId, setSelectedFloorId] = usePageViewState<string | null>(
    `rooms:${jobId}:selectedFloorId`,
    null,
  );
  const [selectedRoomId, setSelectedRoomId] = usePageViewState<string | null>(
    `rooms:${jobId}:selectedRoomId`,
    null,
  );
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
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
  const [traceRoomId, setTraceRoomId] = useState<string | null>(null);
  const [vertexMode, setVertexMode] = useState<"add" | "delete" | null>(null);
  const handledDetectJob = useRef("");
  // The floor name box is left alone while typing (no React re-sets, which
  // trip up the iPhone keyboard) and saved once when editing ends.
  const floorNameInput = useRef<HTMLInputElement | null>(null);
  const lastFloorRename = useRef("");
  const [isRoomListOpen, setIsRoomListOpen] = usePageViewState(
    `rooms:${jobId}:isRoomListOpen`,
    false,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
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
  const roomsQuery = api.rooms.getJobRooms.useQuery(
    { jobId },
    {
      refetchInterval: (query) =>
        !sandbox &&
        query.state.data?.floors.some((floor) => detectionBusy(floor.detection))
          ? 5000
          : false,
      refetchIntervalInBackground: false,
    },
  );
  const renameFloor = api.rooms.renameFloor.useMutation({
    onSuccess: () => void utils.rooms.getJobRooms.invalidate({ jobId }),
    onError: (error, variables) => {
      lastFloorRename.current = "";
      notify(`The floor name was not saved: ${error.message}`, "error");
      const input = floorNameInput.current;
      const saved = utils.rooms.getJobRooms
        .getData({ jobId })
        ?.floors.find((floor) => floor.id === variables.floorId)?.name;
      if (input && saved) input.value = saved;
    },
  });
  const addRoom = api.rooms.addRoom.useMutation({
    onSuccess: () => utils.rooms.getJobRooms.invalidate({ jobId }),
  });
  const [failedRoomUpdate, setFailedRoomUpdate] = useState<
    Parameters<typeof utils.client.rooms.updateRoom.mutate>[0] | null
  >(null);
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
        setDetectError(
          "This outline changed again. Reload the latest outline before editing.",
        );
      }
    },
    onError: (error, variables) => {
      setFailedRoomUpdate(variables);
      setRoomUpdateConflict(error.data?.code === "CONFLICT");
      setDetectError(`Room changes could not be saved: ${error.message}`);
    },
  });
  const growRoom = api.rooms.growRoom.useMutation();
  const {
    shape: tracePreview,
    pending: tracePending,
    error: traceError,
    request: requestTracePreview,
    cancel: cancelTracePreview,
    captureCurrent: captureTraceSession,
  } = useRoomTracePreview(selectedFloorId, growRoom.mutateAsync);
  const deleteRoom = api.rooms.deleteRoom.useMutation({
    onSuccess: () => {
      setSelectedRoomId(null);
      setEditingRoomId(null);
      setVertexMode(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
    },
    onError: (error) =>
      notify(`The room was not deleted: ${error.message}`, "error"),
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
    onError: (error) =>
      notify(`The rooms were not deleted: ${error.message}`, "error"),
  });
  const deleteFloor = api.rooms.deleteFloor.useMutation({
    onSuccess: () => {
      setFloorToDelete(null);
      setSelectedFloorId(null);
      setSelectedRoomId(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
    },
    onError: (error) =>
      notify(`The floor was not deleted: ${error.message}`, "error"),
  });
  // One drawing can cover several floors: copy it with its rooms, then rename.
  const copyFloor = api.rooms.copyFloor.useMutation({
    onSuccess: (result) => {
      notify(
        `Floor copied with ${result.roomCount} ${result.roomCount === 1 ? "room" : "rooms"}. Open it to rename it.`,
        "success",
      );
      void utils.rooms.getJobRooms.invalidate({ jobId });
    },
    onError: (error) => notify(error.message, "error"),
  });
  const detectRooms = api.rooms.detectRooms.useMutation({
    onSuccess: () => {
      setDetectError(null);
      void utils.rooms.detectRoomsStatus.invalidate();
      void utils.rooms.getJobRooms.invalidate({ jobId });
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
      enabled:
        !sandbox && Boolean(selectedFloorId && roomsQuery.data?.canManage),
      refetchInterval: (query) =>
        detectionBusy(query.state.data) ||
        detectRooms.isPending ||
        (Boolean(selectedFloorId) && detectingRoomId === selectedFloorId)
          ? 1000
          : 5000,
    },
  );

  useEffect(() => {
    const job = detectStatus.data;
    if (
      detectRooms.isPending ||
      !job ||
      (job.status !== "done" && job.status !== "error")
    )
      return;
    const key = `${job.floorId}:${job.status}:${job.startedAt}`;
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

  const account = useDrawingAccount();
  const roomSnapshot = useDrawingSnapshot(
    `room-sheets:${jobId}`,
    roomsQuery.data,
  );
  const data = roomSnapshot.data;
  const canManage =
    !sandbox && roomSnapshot.online && (data?.canManage ?? false);
  const drawingPermissions = useDrawingCapabilities();
  const canUpload =
    !sandbox &&
    roomSnapshot.online &&
    (drawingPermissions.canUpload ??
      data?.canUpload ??
      data?.canManage ??
      false);
  const canDelete =
    !sandbox &&
    roomSnapshot.online &&
    (drawingPermissions.canDelete ??
      data?.canDelete ??
      data?.canManage ??
      false);
  const floors = (data?.floors ?? []).map((floor) => ({
    ...floor,
    rooms: floor.rooms.filter(
      (room) =>
        room.reviewStatus !== "superseded" && room.reviewStatus !== "rejected",
    ),
  }));
  const selectedFloor =
    floors.find((floor) => floor.id === selectedFloorId) ?? null;
  const queuedFloors = floors.filter(
    (floor) => floor.detection?.status === "queued",
  ).length;
  const runningFloors = floors.filter(
    (floor) => floor.detection?.status === "running",
  ).length;
  const failedFloors = floors.filter(
    (floor) => floor.detection?.status === "error",
  ).length;
  // Short instructions only while an edit tool needs them.
  const toolHint = createMode
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
            : null;
  const selectedRoom =
    selectedFloor?.rooms.find((room) => room.id === selectedRoomId) ?? null;
  // The overview can know a batch is queued before the selected floor's detailed
  // status has refreshed. Never offer another launch against that known queue.
  const selectedDetection = detectionBusy(detectStatus.data)
    ? detectStatus.data
    : detectionBusy(selectedFloor?.detection)
      ? selectedFloor?.detection
      : detectStatus.data?.status !== "idle"
        ? (detectStatus.data ?? selectedFloor?.detection)
        : selectedFloor?.detection;
  const isQueued = selectedDetection?.status === "queued";
  const isDetecting = detectRooms.isPending || detectionBusy(selectedDetection);
  const detectLog =
    detectStatus.data?.status === selectedDetection?.status
      ? (detectStatus.data?.log ?? [])
      : [];
  const currentDetectMessage = isQueued
    ? detectionMessage(selectedDetection)
    : (detectLog.at(-1)?.message ??
      (detectRooms.isPending
        ? "Adding sheet to detection queue…"
        : detectionMessage(selectedDetection)));
  const detectHistory = detectLog.slice(-8, -1);
  const canEditFloor = canManage && editMode;
  const editMenuOpen = canManage && editMode;
  /** Saves the typed floor name; a blank name puts the current one back. */
  const flushFloorRename = () => {
    const input = floorNameInput.current;
    if (!selectedFloor || !input) return;
    const trimmed = input.value.trim();
    if (!trimmed) {
      input.value = selectedFloor.name;
      return;
    }
    // Blur and Done can both fire for one edit; send each new name once.
    const request = `${selectedFloor.id}\n${trimmed}`;
    if (trimmed === selectedFloor.name || lastFloorRename.current === request)
      return;
    lastFloorRename.current = request;
    renameFloor.mutate({ floorId: selectedFloor.id, name: trimmed });
  };

  const closeFloorViewer = () => {
    flushFloorRename();
    setIsRoomListOpen(false);
    setSelectedFloorId(null);
    setSelectedRoomId(null);
    setEditingRoomId(null);
    setCreateMode(false);
    setDetectMode(false);
    setDetectingRoomId(null);
    setTraceInclude([]);
    setTraceExclude([]);
    cancelTracePreview();
    setTraceRoomId(null);
    setVertexMode(null);
    setEditMode(false);
  };
  // The app bar back arrow steps out of a room, then out of the floor plan.
  useHeaderBackOverride(
    selectedRoom
      ? () => setSelectedRoomId(null)
      : selectedFloor
        ? closeFloorViewer
        : null,
  );

  const exitEditMode = () => {
    flushFloorRename();
    setEditMode(false);
    setEditingRoomId(null);
    setCreateMode(false);
    setVertexMode(null);
    setDetectMode(false);
    setTraceInclude([]);
    setTraceExclude([]);
    cancelTracePreview();
    setTraceRoomId(null);
  };

  const startDetect = (
    method: "standard" | "hybrid" | "complete" = "complete",
  ) => {
    if (sandbox || !selectedFloor || isDetecting) return;
    setDetectError(null);
    cancelTracePreview();
    setDetectMode(false);
    setDetectingRoomId(selectedFloor.id);
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
    cancelTracePreview();
    setTraceRoomId(null);
  };

  const requestTrace = (
    include: { x: number; y: number }[],
    exclude: { x: number; y: number }[],
    roomId = traceRoomId,
  ) => {
    if (!selectedFloor || include.length === 0) return;
    setDetectError(null);
    void requestTracePreview({
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
    const include = polygon ? [roomLabelPoint(polygon)] : [];
    cancelTracePreview();
    setEditingRoomId(null);
    setSelectedRoomId(null);
    setCreateMode(false);
    setDetectMode(true);
    setTraceMode("include");
    setTraceRoomId(roomId ?? null);
    setTraceInclude(include);
    setTraceExclude([]);
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
    if (
      !selectedFloor ||
      !tracePreview ||
      tracePending ||
      addRoom.isPending ||
      updateRoom.isPending
    )
      return;
    const stillCurrent = captureTraceSession();
    if (traceRoomId) {
      updateRoom.mutate(
        {
          roomId: traceRoomId,
          shape: tracePreview,
          expectedUpdatedAt: roomEditVersions.current.get(traceRoomId),
        },
        {
          onSuccess: () => {
            if (stillCurrent()) resetTrace();
          },
        },
      );
      return;
    }
    addRoom.mutate(
      { floorId: selectedFloor.id, name: "New room", shape: tracePreview },
      {
        onSuccess: (room) => {
          if (!stillCurrent()) return;
          focusAddedRoom(room);
          resetTrace();
        },
        onError: (error) => {
          if (stillCurrent())
            setDetectError(`Room could not be added: ${error.message}`);
        },
      },
    );
  };

  const focusAddedRoom = (
    room: { id: string; name: string; updatedAt: Date } | undefined,
  ) => {
    if (!room) return;
    setSelectedRoomId(null);
    setEditingRoomId(room.id);
    setRoomNameDraft(room.name);
    roomEditVersions.current.set(room.id, room.updatedAt.getTime());
  };

  // Added floors are queued for detection on the server; open the first.
  const floorsAdded = (floorIds: string[]) => {
    const first = floorIds[0];
    if (!first) return;
    setSelectedFloorId(first);
    setSelectedRoomId(null);
    setDetectingRoomId(first);
    setEditMode(true);
  };

  if (roomsQuery.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1].map((index) => (
          <Card key={index}>
            <CardHeader>
              <Skeleton className="h-6 w-2/3" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-4 w-1/2" />
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
          <Button
            data-tutorial="room-back"
            variant="outline"
            onClick={() => setSelectedRoomId(null)}
          >
            Back to floor
          </Button>
        </div>
        <RoomDetails
          key={selectedRoom.id}
          room={selectedRoom}
          jobId={jobId}
          canEditNotes={roomsQuery.data?.canEditNotes ?? false}
          canRequestMaterial={roomsQuery.data?.canRequestMaterial ?? false}
          draft={notesDrafts[selectedRoom.id]}
          onDraftChange={(draft) =>
            setNotesDrafts((current) => ({
              ...current,
              [selectedRoom.id]: draft,
            }))
          }
          onOpenMaterialList={
            onOpenMaterialList ??
            ((id) => router.push(`/dashboard/material-lists/${id}`))
          }
        />
      </div>
    );
  }

  return (
    <>
      {!selectedFloor ? (
        <div className={canUpload ? "sm:pb-20" : undefined}>
          <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <PageHeader
              level="section"
              title="Rooms"
              description="Rooms found on each floor plan"
              className="mb-0"
              titleProps={{ "data-tutorial": "rooms-root" }}
            />
            {canUpload ? (
              <div className="bg-background pin-viewport-bottom fixed inset-x-0 bottom-0 z-40 border-t px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:px-6">
                <div className="mx-auto max-w-6xl">
                  <Button
                    onClick={() => setPickerOpen(true)}
                    size="lg"
                    className="h-12 w-full"
                  >
                    <PlusIcon className="mr-2 h-5 w-5" />
                    {floors.length > 0
                      ? "Add more floors from Drawings"
                      : "Choose floor plans from Drawings"}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {canUpload ? (
            <RoomDrawingPicker
              jobId={jobId}
              open={pickerOpen}
              onOpenChange={setPickerOpen}
              onAdded={floorsAdded}
              onOpenDrawings={
                onOpenDrawings ??
                (() => router.push(`/dashboard/jobs/${jobId}/drawings`))
              }
            />
          ) : null}
          {data?.plan?.status === "failed" ? (
            <p className="mb-4 text-sm text-red-600">{data.plan.error}</p>
          ) : null}

          {queuedFloors + runningFloors + failedFloors > 0 ? (
            <div
              role="status"
              aria-label="Room detection queue"
              className="bg-card mb-4 space-y-1 rounded-lg border p-3 text-sm"
            >
              <p className="font-medium">
                {runningFloors} processing · {queuedFloors} queued
                {failedFloors > 0 ? ` · ${failedFloors} failed` : ""}
              </p>
              {queuedFloors + runningFloors > 0 ? (
                <p className="text-muted-foreground">
                  Sheets run one at a time. Detection continues when you leave
                  this screen.
                </p>
              ) : null}
              {failedFloors > 0 ? (
                <p className="text-muted-foreground">
                  Open a failed sheet and use Edit → Detect rooms to retry it.
                </p>
              ) : null}
            </div>
          ) : null}

          {floors.length === 0 ? (
            <Card>
              <CardContent className="p-0">
                <EmptyState
                  art="blueprint"
                  title={
                    canUpload
                      ? "No rooms yet. Choose the floor plans from Drawings to find them."
                      : "No rooms yet."
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {floors.map((floor) => (
                <Card
                  key={floor.id}
                  data-tutorial="floor-card"
                  data-tutorial-floor-id={floor.id}
                  className="card-lift cursor-pointer"
                  onClick={() => {
                    setSelectedFloorId(floor.id);
                    setSelectedRoomId(null);
                    setEditingRoomId(null);
                    setCreateMode(false);
                    setVertexMode(null);
                    setEditMode(false);
                  }}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <CardTitle className="line-clamp-2 min-w-0 leading-tight break-words">
                        {floor.name}
                      </CardTitle>
                      {canManage || canDelete ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground -mt-3 -mr-3 h-10 w-10 shrink-0"
                              aria-label={`More actions for ${floor.name}`}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <MoreVerticalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onClick={(event) => event.stopPropagation()}
                          >
                            {canUpload && (
                              <>
                                <DropdownMenuItem
                                  disabled={
                                    copyFloor.isPending ||
                                    detectionBusy(floor.detection)
                                  }
                                  onSelect={() =>
                                    copyFloor.mutate({ floorId: floor.id })
                                  }
                                >
                                  <CopyIcon className="h-4 w-4" />
                                  Copy floor
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                              </>
                            )}
                            {canDelete && (
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={detectionBusy(floor.detection)}
                                onSelect={() =>
                                  setFloorToDelete({
                                    id: floor.id,
                                    name: floor.name,
                                    roomCount: floor.rooms.length,
                                  })
                                }
                              >
                                <TrashIcon className="h-4 w-4" />
                                Delete floor
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </CardHeader>
                  <div className="px-6 pb-2">
                    <SheetOfflineButton
                      sheet={floor}
                      prepare={async () => {
                        if (data)
                          await account?.store?.saveSnapshot(
                            `room-sheets:${jobId}`,
                            data,
                          );
                      }}
                    />
                  </div>
                  <CardContent>
                    <div className="text-muted-foreground space-y-2 text-sm">
                      <div className="flex items-center gap-2">
                        <DoorOpenIcon className="h-4 w-4" />
                        <span>
                          {floor.rooms.length}{" "}
                          {floor.rooms.length === 1 ? "room" : "rooms"}
                        </span>
                      </div>
                      <div>{detectionMessage(floor.detection) ?? "Ready"}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {selectedFloor ? (
        // Full screen under the app bar: the drawing fills everything above
        // the bottom bar; the room list and edit menu slide up over the bar.
        <div
          data-tutorial="drawing-viewer"
          className="bg-background fixed inset-x-0 top-14 bottom-0 z-30 flex flex-col sm:top-16"
        >
          <div className="relative min-h-0 flex-1">
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
              selectedRoomId={selectedRoomId}
              editingRoomId={editingRoomId}
              detectingRoomId={null}
              createMode={createMode}
              detectMode={detectMode}
              vertexMode={vertexMode}
              canEdit={canEditFloor && !updateRoom.isPending}
              onSelectRoom={(roomId) => {
                if (updateRoom.isPending && editMode) return;
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
                      const stillCurrent = captureTraceSession();
                      addRoom.mutate(
                        {
                          floorId: selectedFloor.id,
                          name: "New room",
                          shape,
                        },
                        {
                          onSuccess: (room) => {
                            if (stillCurrent()) focusAddedRoom(room);
                          },
                          onError: (error) => {
                            if (stillCurrent())
                              setDetectError(
                                `Room could not be added: ${error.message}`,
                              );
                          },
                        },
                      );
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
            <div className="pointer-events-none absolute inset-x-2 top-2 z-10 flex flex-col items-start gap-1">
              <span className="bg-card/90 text-foreground rounded-md px-2 py-1 text-xs font-semibold shadow-sm backdrop-blur">
                {selectedFloor.name}
              </span>
              {detectionBusy(selectedDetection) ? (
                <span
                  role="status"
                  className="bg-card/95 text-foreground max-w-full rounded-md px-2 py-1 text-xs shadow-sm backdrop-blur"
                >
                  {detectionMessage(selectedDetection)} · You can leave this
                  screen.
                </span>
              ) : null}
              {toolHint ? (
                <span className="bg-card/90 text-foreground rounded-md px-2 py-1 text-xs shadow-sm backdrop-blur">
                  {toolHint}
                </span>
              ) : null}
              {updateRoom.isPending ? (
                <span
                  role="status"
                  className="bg-card/90 text-foreground rounded-md px-2 py-1 text-xs shadow-sm backdrop-blur"
                >
                  Saving outline…
                </span>
              ) : null}
              {detectMode && tracePending ? (
                <span
                  role="status"
                  className="bg-card/90 text-foreground rounded-md px-2 py-1 text-xs shadow-sm backdrop-blur"
                >
                  Tracing room…
                </span>
              ) : null}
            </div>
          </div>

          {detectError || traceError ? (
            <div className="bg-card shrink-0 border-t px-3 py-2">
              {detectError || traceError ? (
                <p className="shrink-0 px-1 text-sm text-red-600">
                  {detectError || traceError}
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
                        roomEditVersions.current.delete(
                          failedRoomUpdate.roomId,
                        );
                        setEditingRoomId(null);
                        cancelTracePreview();
                        setTraceRoomId(null);
                        setFailedRoomUpdate(null);
                        setRoomUpdateConflict(false);
                        setDetectError(null);
                      }}
                    >
                      {roomUpdateConflict
                        ? "Reload latest outline"
                        : "Retry save"}
                    </Button>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}

          {isRoomListOpen && selectedFloor.rooms.length > 0 ? (
            <div
              className="bg-card max-h-[45dvh] shrink-0 overflow-y-auto overscroll-contain border-t px-3 py-2"
              aria-label="Room list"
            >
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {selectedFloor.rooms.map((room, index) => {
                  const color = getRoomColor(index);
                  return (
                    <button
                      key={room.id}
                      data-tutorial="room-list-item"
                      data-tutorial-room-id={room.id}
                      type="button"
                      disabled={updateRoom.isPending && editMode}
                      className="hover:bg-card flex items-center gap-2 rounded px-1 py-0.5 text-left text-sm"
                      onClick={() => {
                        setIsRoomListOpen(false);
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
          ) : null}

          {editMenuOpen ? (
            <div
              className="bg-card max-h-[50dvh] shrink-0 space-y-3 overflow-y-auto overscroll-contain border-t px-3 py-3"
              aria-label="Edit menu"
            >
              {canEditFloor ? (
                <Input
                  key={selectedFloor.id}
                  ref={floorNameInput}
                  defaultValue={selectedFloor.name}
                  maxLength={255}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
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
              <div className="flex flex-wrap gap-2">
                {canEditFloor && detectMode ? (
                  <>
                    <Button
                      variant={traceMode === "include" ? "default" : "outline"}
                      onClick={() => setTraceMode("include")}
                    >
                      + Include
                    </Button>
                    <Button
                      variant={traceMode === "exclude" ? "default" : "outline"}
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
                      disabled={
                        !tracePreview ||
                        tracePending ||
                        addRoom.isPending ||
                        updateRoom.isPending
                      }
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
                      variant={vertexMode === "add" ? "default" : "outline"}
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
                      variant={vertexMode === "delete" ? "default" : "outline"}
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
                      {detectRooms.isPending
                        ? "Queuing…"
                        : isQueued
                          ? "Queued…"
                          : isDetecting
                            ? "Detecting…"
                            : "Detect rooms"}
                    </Button>
                    <Button
                      variant={createMode ? "outline" : "default"}
                      onClick={() => {
                        cancelTracePreview();
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
                  </>
                ) : null}
              </div>
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
              {isDetecting && currentDetectMessage ? (
                <div
                  role="log"
                  aria-label="Room detection progress"
                  className="max-h-36 shrink-0 overflow-y-auto rounded-md border bg-slate-950 font-mono text-xs text-slate-100"
                >
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
            </div>
          ) : null}

          <div className="bg-card shrink-0 border-t px-4 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto grid max-w-6xl grid-cols-3 gap-1.5">
              <Button
                data-tutorial="room-list-toggle"
                variant={isRoomListOpen ? "default" : "outline"}
                className="h-10 w-full px-1.5 text-xs leading-tight whitespace-normal"
                aria-expanded={isRoomListOpen}
                disabled={selectedFloor.rooms.length === 0}
                onClick={() => setIsRoomListOpen((open) => !open)}
              >
                <ListIcon className="mr-1 h-4 w-4 shrink-0" />
                Rooms ({selectedFloor.rooms.length})
              </Button>
              <Button
                variant={editMenuOpen ? "default" : "outline"}
                className="h-10 w-full px-1.5 text-xs leading-tight whitespace-normal"
                aria-expanded={editMenuOpen}
                disabled={!canManage}
                onClick={() => {
                  if (editMenuOpen) {
                    exitEditMode();
                  } else {
                    setEditMode(true);
                  }
                }}
              >
                <PencilIcon className="mr-1 h-4 w-4 shrink-0" />
                {editMenuOpen ? "Done" : "Edit"}
              </Button>
              <SheetOfflineButton
                sheet={selectedFloor}
                prepare={async () => {
                  if (data)
                    await account?.store?.saveSnapshot(
                      `room-sheets:${jobId}`,
                      data,
                    );
                }}
              />
            </div>
          </div>
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
              disabled={!canDelete || !floorToDelete || deleteFloor.isPending}
              onClick={() => {
                if (!canDelete || !floorToDelete) return;
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
