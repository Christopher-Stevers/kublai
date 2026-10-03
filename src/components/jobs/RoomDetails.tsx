"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { api } from "~/trpc/react";
import { formatMaterialListDate } from "~/lib/material-list-names";
import {
  getMaterialListReplicache,
  mutateMaterialListAndSync,
} from "~/lib/replicache-material-list";

export type RoomNotesDraft = { notes: string; notesRevision: number };

export function RoomDetails({
  room,
  jobId,
  canEditNotes,
  canRequestMaterial,
  draft,
  onDraftChange,
  onOpenMaterialList,
}: {
  room: { id: string; name: string; notes: string; notesRevision: number };
  jobId: string;
  canEditNotes: boolean;
  canRequestMaterial: boolean;
  draft?: RoomNotesDraft;
  onDraftChange: (draft: RoomNotesDraft | undefined) => void;
  onOpenMaterialList: (id: string) => void;
}) {
  const utils = api.useUtils();
  const updateNotes = api.rooms.updateNotes.useMutation();
  const [saved, setSaved] = useState<RoomNotesDraft | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const creatingRef = useRef(false);
  const requestId = useRef<string | null>(null);
  const mounted = useRef(true);
  const [latest, setLatest] = useState<RoomNotesDraft | null>(null);
  const [loadingLatest, setLoadingLatest] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const loadLatestNotes = async () => {
    setLoadingLatest(true);
    try {
      const data = await utils.rooms.getJobRooms.fetch({ jobId });
      const current = data.floors
        .flatMap((floor) => floor.rooms)
        .find((item) => item.id === room.id);
      if (!current) throw new Error("This room is no longer available.");
      setLatest({ notes: current.notes, notesRevision: current.notesRevision });
    } catch (error) {
      setNoteError(
        error instanceof Error ? error.message : "Could not load saved notes.",
      );
    } finally {
      setLoadingLatest(false);
    }
  };
  const base = saved && saved.notesRevision > room.notesRevision ? saved : room;
  const dirty = draft !== undefined && draft.notes !== base.notes;

  const saveNotes = async () => {
    if (!draft || !dirty) return true;
    setNoteError(null);
    try {
      const result = await updateNotes.mutateAsync({
        roomId: room.id,
        notes: draft.notes,
        expectedNotesRevision: draft.notesRevision,
      });
      setSaved(result);
      onDraftChange(undefined);
      setSavedMessage(true);
      setLatest(null);
      void utils.rooms.getJobRooms.invalidate({ jobId });
      return true;
    } catch (error) {
      setNoteError(
        error instanceof Error
          ? error.message
          : "Notes could not be saved. Please try again.",
      );
      return false;
    }
  };

  const requestMaterial = async () => {
    if (creatingRef.current || !canRequestMaterial) return;
    creatingRef.current = true;
    setCreating(true);
    setRequestError(null);
    try {
      if (dirty && !(await saveNotes())) return;
      if (!mounted.current) return;
      requestId.current ??= crypto.randomUUID();
      const suffix = ` — ${formatMaterialListDate()}`;
      const name = `${room.name.trim().slice(0, 255 - suffix.length)}${suffix}`;
      await mutateMaterialListAndSync(
        getMaterialListReplicache().mutate.createMaterialList({
          materialListId: requestId.current,
          jobId,
          name,
        }),
      );
      if (mounted.current) onOpenMaterialList(requestId.current);
    } catch (error) {
      setRequestError(
        error instanceof Error
          ? error.message
          : "The material list could not be created. Please try again.",
      );
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <label htmlFor={`room-notes-${room.id}`}>Room notes</label>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            id={`room-notes-${room.id}`}
            rows={6}
            maxLength={10000}
            placeholder="Leave notes for this room…"
            value={draft?.notes ?? base.notes}
            readOnly={!canEditNotes}
            disabled={updateNotes.isPending || creating}
            onChange={(event) => {
              setSavedMessage(false);
              onDraftChange({
                notes: event.target.value,
                notesRevision: draft?.notesRevision ?? base.notesRevision,
              });
            }}
          />
          {noteError && (
            <p role="alert" className="text-sm text-red-600">
              {noteError}
            </p>
          )}
          {noteError && canEditNotes && (
            <div className="space-y-2">
              <Button
                variant="outline"
                disabled={loadingLatest}
                onClick={() => void loadLatestNotes()}
              >
                {loadingLatest ? "Loading…" : "Review latest saved notes"}
              </Button>
              {latest && (
                <div className="space-y-2 rounded-md border p-3">
                  <p className="text-sm font-medium">Latest saved notes</p>
                  <p className="text-sm whitespace-pre-wrap">
                    {latest.notes || "No notes"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSaved(latest);
                        onDraftChange(undefined);
                        setNoteError(null);
                        setLatest(null);
                      }}
                    >
                      Use saved notes
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSaved(latest);
                        onDraftChange({
                          notes: draft?.notes ?? base.notes,
                          notesRevision: latest.notesRevision,
                        });
                        setNoteError(null);
                        setLatest(null);
                      }}
                    >
                      Keep my draft
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {canEditNotes && (
            <div className="flex items-center gap-3">
              <Button
                disabled={!dirty || updateNotes.isPending || creating}
                onClick={() => void saveNotes()}
              >
                {updateNotes.isPending ? "Saving…" : "Save notes"}
              </Button>
              <span role="status" className="text-muted-foreground text-sm">
                {dirty ? "Unsaved changes" : savedMessage ? "Saved" : ""}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
      {canRequestMaterial && (
        <Card>
          <CardHeader>
            <CardTitle>Materials</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button
              onClick={() => void requestMaterial()}
              disabled={creating || updateNotes.isPending}
            >
              {creating ? "Creating list…" : "Request material"}
            </Button>
            {requestError && (
              <p role="alert" className="text-sm text-red-600">
                {requestError}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
