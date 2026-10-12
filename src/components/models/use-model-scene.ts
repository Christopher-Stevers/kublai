"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { ModelScene } from "~/lib/bim/scene";
import type {
  BimElement,
  BimIssue,
  BimMeasurement,
  BimProperties,
  BimViewState,
  Point3,
} from "~/lib/bim/types";
import type { IfcReply, IfcRequest } from "~/lib/bim/worker-protocol";
import { installedModelStorage } from "~/lib/bim/installed-model-storage";
import { modelFileUrl } from "~/lib/bim/client";
export function useModelScene(
  host: RefObject<HTMLDivElement | null>,
  jobId: string,
  ids: string[],
  restore: BimViewState | null,
  reset: number,
  callbacks: {
    select: (e: BimElement | null) => void;
    pin: (e: BimElement, p: Point3) => void;
    issue: (id: string) => void;
    error: (message: string) => void;
  },
) {
  const [scene, setScene] = useState<ModelScene | null>(null),
    [elements, setElements] = useState<BimElement[]>([]),
    [progress, setProgress] = useState(""),
    [properties, setProperties] = useState<BimProperties>([]),
    [measures, setMeasures] = useState<BimMeasurement[]>([]),
    [ready, setReady] = useState(false);
  const cb = useRef(callbacks);
  cb.current = callbacks;
  const desired = useRef(ids);
  desired.current = ids;
  const rest = useRef(restore);
  rest.current = restore;
  const controller = useRef<{
    sync: () => void;
    properties: (e: BimElement) => void;
  } | null>(null);
  useEffect(() => {
    let disposed = false,
      engine: ModelScene | null = null,
      worker: Worker | null = null,
      loading: { modelId: string; loadId: number } | null = null,
      loadRequest = 0,
      ackFrame = 0,
      ackTimer: ReturnType<typeof setTimeout> | undefined,
      request = 0,
      lastRequest = 0,
      restored = false;
    const loaded = new Set<string>(),
      failed = new Set<string>();
    const send = (m: IfcRequest) => worker?.postMessage(m);
    const cancelAck = () => {
      cancelAnimationFrame(ackFrame);
      clearTimeout(ackTimer);
    };
    const acknowledgeAfterFrame = (
      m: Extract<IfcReply, { type: "geometry" }>,
    ) => {
      cancelAck();
      const acknowledge = () => {
        cancelAck();
        if (!disposed)
          send({
            type: "ack",
            modelId: m.modelId,
            loadId: m.loadId,
            chunkId: m.chunkId,
          });
      };
      // addParts schedules the render first. Do not queue the next chunk until
      // this frame has run; hidden tabs need a timer fallback to keep loading.
      ackFrame = requestAnimationFrame(acknowledge);
      ackTimer = setTimeout(acknowledge, 100);
    };
    const sync = () => {
      if (!engine || !worker || disposed) return;
      for (const id of loaded)
        if (!desired.current.includes(id)) {
          engine.removeModel(id);
          send({ type: "close", modelId: id });
          loaded.delete(id);
        }
      for (const id of failed)
        if (!desired.current.includes(id)) failed.delete(id);
      if (loading && !desired.current.includes(loading.modelId)) {
        cancelAck();
        engine.removeModel(loading.modelId);
        send({ type: "close", modelId: loading.modelId });
        loading = null;
      }
      if (loading) return;
      const next = desired.current.find(
        (id) => !loaded.has(id) && !failed.has(id),
      );
      if (next) {
        loading = { modelId: next, loadId: ++loadRequest };
        setReady(false);
        setProgress("Opening model…");
        send({
          type: "load",
          modelId: next,
          loadId: loading.loadId,
          url: modelFileUrl(jobId, next),
          installedApp: installedModelStorage(),
        });
        return;
      }
      setProgress("");
      setElements([...engine.elements.values()].map((e) => e.info));
      setReady(
        desired.current.length > 0 &&
          desired.current.every((id) => loaded.has(id)),
      );
      if (
        !restored &&
        rest.current &&
        desired.current.every((id) => loaded.has(id))
      ) {
        engine.restore(rest.current);
        setMeasures(rest.current.measurements);
        restored = true;
      }
    };
    setScene(null);
    setElements([]);
    setProperties([]);
    setMeasures([]);
    setReady(false);
    void import("~/lib/bim/scene")
      .then(({ ModelScene }) => {
        if (disposed || !host.current) return;
        engine = new ModelScene(host.current, {
          select: (e) => {
            if (disposed) return;
            lastRequest = ++request;
            setProperties([]);
            if (e) controller.current?.properties(e);
            cb.current.select(e);
          },
          pin: (e, p) => cb.current.pin(e, p),
          issue: (id) => cb.current.issue(id),
          error: (m) => cb.current.error(m),
          measurement: (m) => {
            if (!disposed) setMeasures(m);
          },
        });
        if (rest.current) engine.setOrigin(rest.current.origin);
        engine.setDark(document.documentElement.classList.contains("dark"));
        worker = new Worker(
          new URL("../../lib/bim/ifc.worker.ts", import.meta.url),
        );
        worker.onerror = () => {
          if (!disposed) {
            cb.current.error(
              "The model engine could not start. Refresh the page and try again.",
            );
            setProgress("");
            setReady(false);
          }
        };
        worker.onmessage = (event: MessageEvent<IfcReply>) => {
          if (disposed || !engine) return;
          const m = event.data;
          if (m.type === "properties") {
            if (m.requestId === lastRequest) setProperties(m.properties);
            return;
          }
          if (m.type === "error" && m.requestId) {
            if (m.requestId === lastRequest) {
              setProperties([]);
              cb.current.error(m.message);
            }
            return;
          }
          if (m.modelId !== loading?.modelId || m.loadId !== loading.loadId)
            return;
          if (!desired.current.includes(m.modelId)) {
            sync();
            return;
          }
          if (m.type === "progress")
            setProgress(`${m.message} · ${Math.round(m.progress)}%`);
          if (m.type === "geometry") {
            try {
              const first = engine.elements.size === 0;
              engine.addParts(m.modelId, m.parts, m.elements);
              if (first && !rest.current) engine.fit(undefined, false);
              acknowledgeAfterFrame(m);
            } catch (error) {
              cancelAck();
              failed.add(m.modelId);
              engine.removeModel(m.modelId);
              send({ type: "close", modelId: m.modelId });
              loading = null;
              cb.current.error(
                error instanceof Error
                  ? error.message
                  : "This device could not render the model. Close other models and try again.",
              );
              sync();
            }
          }
          if (m.type === "ready") {
            if (!failed.has(m.modelId)) {
              loaded.add(m.modelId);
              engine.finishModel(m.modelId, m.elements);
              if (!rest.current) engine.fit(undefined, false);
            }
            loading = null;
            sync();
          }
          if (m.type === "error") {
            failed.add(m.modelId);
            engine.removeModel(m.modelId);
            loading = null;
            cb.current.error(m.message);
            sync();
          }
        };
        controller.current = {
          sync,
          properties: (e) => {
            lastRequest = ++request;
            setProperties([]);
            send({
              type: "properties",
              modelId: e.modelId,
              expressId: e.expressId,
              requestId: lastRequest,
            });
          },
        };
        setScene(engine);
        sync();
      })
      .catch(() =>
        cb.current.error(
          "3D rendering is unavailable. Check that your browser supports WebGL.",
        ),
      );
    return () => {
      disposed = true;
      controller.current = null;
      cancelAck();
      worker?.terminate();
      engine?.dispose();
    };
  }, [host, jobId, reset]);
  useEffect(() => {
    controller.current?.sync();
  }, [ids]);
  useEffect(() => {
    if (!scene) return;
    const observer = new MutationObserver(() =>
      scene.setDark(document.documentElement.classList.contains("dark")),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, [scene]);
  return {
    scene,
    elements,
    progress,
    properties,
    measures,
    ready,
    inspect: (e: BimElement) => {
      scene?.select(e.key);
      controller.current?.properties(e);
      cb.current.select(e);
    },
    setIssues: (issues: BimIssue[]) => scene?.setIssues(issues),
  };
}
