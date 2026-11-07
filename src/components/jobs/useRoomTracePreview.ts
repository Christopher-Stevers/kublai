"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoomShape } from "~/lib/room-shape";

/** A preview belongs to the latest set of taps on one floor, never a late reply. */
export function useRoomTracePreview<Input>(
  floorId: string | null,
  execute: (input: Input) => Promise<{ shape: RoomShape }>,
) {
  const generation = useRef(0);
  const [state, setState] = useState<{
    floorId: string | null;
    shape: RoomShape | null;
    pending: boolean;
    error: string | null;
  } | null>(null);

  // Also invalidates requests when leaving the floor or unmounting the view.
  useEffect(() => {
    // Navigation invalidates the completed preview as well as in-flight work.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(null);
    return () => {
      generation.current += 1;
    };
  }, [floorId]);

  const cancel = useCallback(() => {
    generation.current += 1;
    setState(null);
  }, []);

  // Save requests cannot be cancelled once sent, but their eventual UI effects
  // must still belong to the same floor/session and the same set of taps.
  const captureCurrent = useCallback(() => {
    const ticket = generation.current;
    return () => ticket === generation.current;
  }, []);

  const request = useCallback(
    async (input: Input) => {
      const ticket = ++generation.current;
      // An older outline must not remain saveable while new constraints run.
      setState({ floorId, shape: null, pending: true, error: null });
      try {
        const result = await execute(input);
        if (ticket === generation.current)
          setState({
            floorId,
            shape: result.shape,
            pending: false,
            error: null,
          });
      } catch (error) {
        if (ticket === generation.current)
          setState({
            floorId,
            shape: null,
            pending: false,
            error:
              error instanceof Error ? error.message : "Room tracing failed",
          });
      }
    },
    [execute, floorId],
  );

  const current = state?.floorId === floorId ? state : null;
  return {
    shape: current?.shape ?? null,
    pending: current?.pending ?? false,
    error: current?.error ?? null,
    request,
    cancel,
    captureCurrent,
  };
}
