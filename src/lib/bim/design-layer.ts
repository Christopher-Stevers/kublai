import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { ModelScene } from "./scene";
import {
  emptyDesign,
  type ModelDesign,
  type DesignKind,
  type CadMesh,
} from "./design";
import { designObject, disposeDesignObject } from "./design-geometry";
import {
  constrainPoint,
  designLayers,
  elementSnapPoints,
  isEditable,
  planeAxes,
  sketchKinds,
  sketchVertices,
  objectMatrix,
  type CadPlane,
} from "./cad-geometry";
import type { Point3 } from "./types";
export class DesignLayer {
  readonly group = new THREE.Group();
  private objects = new Map<string, THREE.Group>();
  private fingerprints = new Map<
    string,
    { properties: string; mesh?: CadMesh; points?: Point3[] }
  >();
  private design: ModelDesign = emptyDesign();
  private selection: string[] = [];
  private editVertices = false;
  private vertexIndex: number | null = null;
  private vertexHandles = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 10, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }),
    512,
  );
  get vertexMode() {
    return this.editVertices;
  }
  set vertexMode(value: boolean) {
    if (value === this.editVertices) return;
    this.editVertices = value;
    this.vertexIndex = value ? 0 : null;
    this.selectMany(this.selection);
  }
  private controls: TransformControls;
  private proxy = new THREE.Object3D();
  private box = new THREE.Box3Helper(new THREE.Box3(), 0x38bdf8);
  private active = false;
  private placementKind: DesignKind | null = null;
  private points: THREE.Vector3[] = [];
  private preview = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false }),
  );
  private marker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false }),
  );
  private dragStart = new THREE.Vector3();
  private snaps: { point: THREE.Vector3; kind: string }[] = [];
  private snapProjectionKey = "";
  private snapCells = new Map<
    string,
    { x: number; y: number; point: THREE.Vector3; kind: string }[]
  >();
  private nearbySnaps(x: number, y: number) {
    const rect = this.engine.inputRect(),
      camera = this.engine.camera;
    camera.updateMatrixWorld();
    const key = [
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      this.plane,
      this.elevation,
      this.surface,
    ].join(",");
    if (key !== this.snapProjectionKey) {
      this.snapProjectionKey = key;
      this.snapCells.clear();
      const { normal } = planeAxes(this.plane);
      for (const snap of this.snaps) {
        if (
          !this.surface &&
          Math.abs(normal.dot(snap.point) - this.elevation) > 0.001
        )
          continue;
        const p = snap.point.clone().sub(this.engine.origin).project(camera);
        if (p.z < -1 || p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1)
          continue;
        const candidate = {
          ...snap,
          x: ((p.x + 1) * rect.width) / 2 + rect.left,
          y: ((1 - p.y) * rect.height) / 2 + rect.top,
        };
        const cell = `${Math.floor(candidate.x / 14)},${Math.floor(candidate.y / 14)}`;
        const entries = this.snapCells.get(cell) ?? [];
        entries.push(candidate);
        this.snapCells.set(cell, entries);
      }
    }
    const candidates = [];
    const cx = Math.floor(x / 14),
      cy = Math.floor(y / 14);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        candidates.push(...(this.snapCells.get(`${cx + dx},${cy + dy}`) ?? []));
    return candidates;
  }
  private workplane: CadPlane = "top";
  get plane() {
    return this.workplane;
  }
  set plane(plane: CadPlane) {
    if (
      plane !== this.workplane &&
      this.placing &&
      sketchKinds.has(this.placing)
    )
      this.cancelDraft();
    this.workplane = plane;
  }
  elevation = 0;
  snap = 0.05;
  angle: 0 | 45 | 90 = 0;
  exactLength = 0;
  objectSnap = true;
  surface = false;
  chain = false;
  mode: "translate" | "rotate" = "translate";
  get placing() {
    return this.placementKind;
  }
  set placing(value: DesignKind | null) {
    if (value !== this.placementKind) this.cancelDraft();
    this.placementKind = value;
    this.controls.enabled = this.active && !value;
    this.selectMany(this.selection);
  }
  get drafting() {
    return this.points.length > 0;
  }
  constructor(
    readonly engine: ModelScene,
    readonly modelId: string,
    readonly callbacks: {
      select: (id: string | null, extend?: boolean) => void;
      place: (kind: DesignKind, point: Point3, end?: Point3) => void;
      sketch?: (kind: DesignKind, points: Point3[], plane: CadPlane) => void;
      transform: (id: string, position: Point3, rotation: Point3) => void;
      transformMany?: (
        ids: string[],
        delta: Point3,
        rotation: Point3,
        pivot: Point3,
      ) => void;
      status?: (text: string) => void;
      vertex?: (id: string, index: number, point: Point3) => void;
    },
  ) {
    engine.scene.add(
      this.group,
      this.proxy,
      this.box,
      this.preview,
      this.marker,
      this.vertexHandles,
    );
    this.box.visible = this.preview.visible = this.marker.visible = false;
    this.preview.renderOrder = this.marker.renderOrder = 2000;
    this.vertexHandles.count = 0;
    this.vertexHandles.userData.cadActiveOnly = true;
    this.vertexHandles.renderOrder = 2100;
    this.vertexHandles.onBeforeRender = () => this.refreshVertexHandles();
    this.controls = new TransformControls(
      engine.camera,
      engine.renderer.domElement,
    );
    this.controls.enabled = false;
    this.controls.setSpace("world");
    const helper = this.controls.getHelper();
    helper.userData.cadActiveOnly = true;
    engine.scene.add(helper);
    this.controls.addEventListener("change", engine.invalidate);
    this.controls.addEventListener("dragging-changed", (event) => {
      engine.controls.enabled = !event.value;
      if (event.value) {
        this.dragStart.copy(this.proxy.position);
        this.cancelDraft();
        return;
      }
      if (!this.selection.length) return;
      if (this.vertexIndex !== null) {
        this.preview.visible = false;
        const element = this.design.elements.find(
          (e) => e.id === this.selection[0],
        );
        if (element)
          this.callbacks.vertex?.(
            element.id,
            this.vertexIndex,
            this.proxy.position
              .clone()
              .add(engine.origin)
              .applyMatrix4(objectMatrix(element).invert())
              .toArray() as Point3,
          );
        return;
      }
      const rotation = [
        this.proxy.rotation.x,
        this.proxy.rotation.y,
        this.proxy.rotation.z,
      ].map(THREE.MathUtils.radToDeg) as Point3;
      if (this.selection.length === 1)
        callbacks.transform(
          this.selection[0]!,
          this.proxy.position.clone().add(engine.origin).toArray() as Point3,
          rotation,
        );
      else
        callbacks.transformMany?.(
          this.selection,
          this.proxy.position.clone().sub(this.dragStart).toArray() as Point3,
          rotation,
          this.dragStart.clone().add(engine.origin).toArray() as Point3,
        );
    });
    this.controls.addEventListener("objectChange", () => {
      if (this.vertexIndex !== null) {
        const e = this.design.elements.find((e) => e.id === this.selection[0]);
        if (e?.points) {
          const closed =
            new THREE.Vector3(...e.points[0]!).distanceTo(
              new THREE.Vector3(...e.points.at(-1)!),
            ) < 1e-8;
          const points = e.points.map((p, i) =>
            i === this.vertexIndex ||
            (closed && this.vertexIndex === 0 && i === e.points!.length - 1)
              ? this.proxy.position.clone()
              : new THREE.Vector3(...p)
                  .applyMatrix4(objectMatrix(e))
                  .sub(engine.origin),
          );
          this.preview.geometry.dispose();
          this.preview.geometry = new THREE.BufferGeometry().setFromPoints(
            points,
          );
          this.preview.visible = true;
        }
        engine.invalidate();
        return;
      }
      if (this.selection.length === 1) {
        const object = this.objects.get(this.selection[0]!);
        if (object) {
          object.position.copy(this.proxy.position);
          object.rotation.copy(this.proxy.rotation);
          this.box.box.setFromObject(object);
        }
      }
      engine.invalidate();
    });
  }
  setDesign(design: ModelDesign) {
    const previous = this.design;
    this.design = design;
    const layers = designLayers(design);
    const ids = new Set(design.elements.map((e) => e.id));
    for (const [id, object] of this.objects)
      if (!ids.has(id)) {
        this.group.remove(object);
        disposeDesignObject(object);
        this.objects.delete(id);
        this.fingerprints.delete(id);
      }
    for (const element of design.elements) {
      // Property changes rebuild only the changed object, never the entire model.
      // Meshes/vertices are immutable. Compare their identities instead of
      // serializing every triangle whenever a name or another object changes.
      const fingerprint = {
        properties: JSON.stringify({
          ...element,
          mesh: undefined,
          points: undefined,
        }),
        mesh: element.mesh,
        points: element.points,
      };
      const before = this.fingerprints.get(element.id);
      let object = this.objects.get(element.id);
      if (
        before?.properties !== fingerprint.properties ||
        before.mesh !== fingerprint.mesh ||
        before.points !== fingerprint.points
      ) {
        if (object) {
          this.group.remove(object);
          disposeDesignObject(object);
        }
        object = designObject(element);
        object.position.sub(this.engine.origin);
        this.group.add(object);
        this.objects.set(element.id, object);
        this.fingerprints.set(element.id, fingerprint);
      }
      object!.visible =
        layers.find((l) => l.name === (element.layer ?? "Design"))?.visible !==
        false;
    }
    this.snapProjectionKey = "";
    this.snaps = design.elements
      .filter((e) => isEditable(design, e))
      .flatMap(elementSnapPoints);
    this.engine.designBounds.set(
      this.modelId,
      new THREE.Box3().setFromObject(this.group),
    );
    if (JSON.stringify(previous.overrides) !== JSON.stringify(design.overrides))
      this.engine.applyDesignOverrides(this.modelId, design.overrides);
    this.selectMany(this.selection);
    this.engine.invalidate();
  }
  setActive(active: boolean) {
    this.active = active;
    this.controls.enabled = active && !this.placing;
    if (active) {
      this.engine.editorTap = this.tap;
      this.engine.editorPointer = this.pointer;
    } else if (this.engine.editorTap === this.tap) {
      this.engine.editorTap = null;
      this.engine.editorPointer = null;
      this.engine.controls.enabled = true;
    }
    if (!active) this.cancelDraft();
    this.selectMany(active ? this.selection : []);
  }
  setMode(mode: "translate" | "rotate") {
    this.mode = mode;
    this.controls.setMode(this.vertexIndex !== null ? "translate" : mode);
    this.controls.setTranslationSnap(this.snap || null);
    this.controls.setRotationSnap(THREE.MathUtils.degToRad(this.angle || 15));
    this.engine.invalidate();
  }
  syncCamera() {
    this.controls.camera = this.engine.camera;
    const input = this.engine.editorInput ?? this.engine.renderer.domElement;
    if (this.controls.domElement !== input) {
      this.controls.disconnect();
      this.controls.connect(input);
    }
  }
  private pointer = (event: PointerEvent) => {
    this.syncCamera();
    if (
      !this.active ||
      this.placing ||
      !this.selection.length ||
      event.button !== 0
    )
      return false;
    const rect = this.engine.inputRect();
    this.controls.pointerHover({
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      button: event.button,
    } as PointerEvent);
    if (this.controls.axis) {
      this.engine.controls.enabled = false;
      return true;
    }
    return false;
  };
  private worldPoint(x: number, y: number) {
    const ray = this.engine.editorRay(x, y),
      { normal } = planeAxes(this.plane);
    const point = ray.ray
      .intersectPlane(
        new THREE.Plane(
          normal,
          -this.elevation + normal.dot(this.engine.origin),
        ),
        new THREE.Vector3(),
      )
      ?.add(this.engine.origin);
    const source = this.surface ? this.engine.editorHit(x, y) : null;
    let result = source?.point ?? point;
    if (!result) return null;
    let kind = this.snap ? "Grid" : "Plane";
    const start = this.points.at(-1) ?? null;
    result = constrainPoint(
      result,
      start,
      this.plane,
      this.snap,
      this.angle,
      this.exactLength,
    );
    if (this.objectSnap && !this.angle && !this.exactLength) {
      let distance = 14;
      for (const candidate of this.nearbySnaps(x, y)) {
        const d = Math.hypot(candidate.x - x, candidate.y - y);
        if (d < distance) {
          distance = d;
          result = candidate.point.clone();
          kind = candidate.kind;
        }
      }
      const anchor = this.engine.editorAnchor(x, y);
      if (
        anchor &&
        distance === 14 &&
        (this.surface ||
          Math.abs(normal.dot(anchor.point) - this.elevation) < 0.001)
      ) {
        result = anchor.point;
        kind = anchor.kind;
      }
      if (this.surface && source && kind === "Plane") kind = "Surface";
    }
    this.callbacks.status?.(
      `${kind} · X ${result.x.toFixed(3)}  Y ${result.y.toFixed(3)}  Z ${result.z.toFixed(3)} m${start ? ` · ${result.distanceTo(start).toFixed(3)} m` : ""}`,
    );
    return result;
  }
  hover = (x: number, y: number) => {
    this.syncCamera();
    if (!this.placing || !this.active) return;
    const point = this.worldPoint(x, y);
    if (!point) return;
    this.marker.position.copy(point).sub(this.engine.origin);
    const camera = this.engine.camera,
      rect = this.engine.inputRect();
    const scale =
      camera instanceof THREE.OrthographicCamera
        ? (camera.top - camera.bottom) / camera.zoom / rect.height
        : (camera.position.distanceTo(this.marker.position) * 0.95) /
          rect.height;
    this.marker.scale.setScalar(Math.max(0.00001, scale * 5));
    this.marker.visible = true;
    this.drawPreview(point);
    this.engine.invalidate();
  };
  private drawPreview(point: THREE.Vector3) {
    if (!this.points.length) {
      this.preview.visible = false;
      return;
    }
    const points = sketchVertices(
      this.placing!,
      [...this.points, point],
      this.plane,
    ).map((p) => p.clone().sub(this.engine.origin));
    this.preview.geometry.dispose();
    this.preview.geometry = new THREE.BufferGeometry().setFromPoints(points);
    this.preview.visible = true;
  }
  private tap = (x: number, y: number) => this.tapAt(x, y);
  tapAt(x: number, y: number, extend = false) {
    this.syncCamera();
    if (this.placing) {
      const point = this.worldPoint(x, y);
      if (point) this.addPoint(point.toArray() as Point3);
      return;
    }
    const ray = this.engine.editorRay(x, y);
    this.refreshVertexHandles();
    if (this.vertexHandles.count) {
      const vertex = ray.intersectObject(this.vertexHandles)[0];
      if (vertex?.instanceId !== undefined) {
        this.vertexIndex = vertex.instanceId;
        this.selectMany(this.selection);
        this.callbacks.status?.(
          `Vertex ${this.vertexIndex + 1} · drag a handle to move it`,
        );
        return;
      }
    }
    ray.params.Line.threshold = this.worldPixel() * 8;
    this.group.updateMatrixWorld(true);
    const hits = ray.intersectObjects(
      [...this.objects.values()].filter((o) => o.visible),
      true,
    );
    const hit = hits.find((h) => {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.designId) o = o.parent;
      const e = this.design.elements.find((e) => e.id === o?.userData.designId);
      return e && isEditable(this.design, e);
    });
    const source = this.engine.editorHit(x, y);
    if (
      hit &&
      (!source ||
        hit.distance <
          ray.ray.origin.distanceTo(
            source.point.clone().sub(this.engine.origin),
          ))
    ) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.designId) o = o.parent;
      this.callbacks.select((o?.userData.designId as string) ?? null, extend);
    } else
      this.callbacks.select(
        source?.element.modelId === this.modelId
          ? `source:${source.element.expressId}`
          : null,
        extend,
      );
  }
  private worldPixel() {
    const c = this.engine.camera,
      h = Math.max(1, this.engine.inputRect().height);
    return c instanceof THREE.OrthographicCamera
      ? (c.top - c.bottom) / c.zoom / h
      : (2 *
          c.position.distanceTo(this.engine.controls.target) *
          Math.tan(THREE.MathUtils.degToRad(c.fov / 2))) /
          h;
  }
  addPoint(value: Point3) {
    if (!this.placing) return;
    const point = new THREE.Vector3(...value),
      kind = this.placing;
    if ((this.points.at(-1)?.distanceTo(point) ?? Infinity) < 0.001) return;
    if (sketchKinds.has(kind)) {
      this.points.push(point);
      if (kind !== "polyline" && this.points.length === 2) this.finishDraft();
      else
        this.callbacks.status?.(
          `${this.points.length} point${this.points.length === 1 ? "" : "s"} · ${kind === "polyline" ? "Add points, then Finish" : "Choose the next point"}`,
        );
    } else if (kind === "pipe" || kind === "duct" || kind === "wall") {
      if (!this.points.length) this.points.push(point);
      else {
        this.callbacks.place(kind, this.points[0]!.toArray() as Point3, value);
        this.points = this.chain ? [point] : [];
        this.preview.visible = false;
      }
    } else this.callbacks.place(kind, value);
    this.engine.invalidate();
  }
  finishDraft(close = false) {
    if (!this.placing || this.points.length < 2) return;
    const points = this.points.map((p) => p.toArray() as Point3);
    if (close && points.length > 2) points.push(points[0]!);
    this.callbacks.sketch?.(this.placing, points, this.plane);
    this.cancelDraft();
  }
  cancelDraft() {
    this.points = [];
    this.preview.visible = this.marker.visible = false;
    this.engine.invalidate();
  }
  select(id: string | null) {
    this.selectMany(id ? [id] : []);
  }
  selectMany(ids: string[]) {
    if (ids.length !== 1 || ids[0] !== this.selection[0] || !this.editVertices)
      this.vertexIndex = null;
    this.selection = ids.filter(
      (id) =>
        id.startsWith("source:") ||
        this.design.elements.some(
          (e) => e.id === id && isEditable(this.design, e),
        ),
    );
    this.controls.detach();
    this.vertexHandles.count = 0;
    this.box.visible = false;
    if (!this.selection.length || !this.active || this.placing) return;
    const bounds = new THREE.Box3();
    for (const id of this.selection) {
      const object = this.objects.get(id);
      if (object) bounds.union(new THREE.Box3().setFromObject(object));
      else if (id.startsWith("source:")) {
        const entry = this.engine.elements.get(
          `${this.modelId}:${id.slice(7)}`,
        );
        if (entry) bounds.union(entry.bounds);
      }
    }
    if (bounds.isEmpty()) return;
    this.box.box.copy(bounds);
    this.box.visible = true;
    this.proxy.position.copy(bounds.getCenter(new THREE.Vector3()));
    this.proxy.rotation.set(0, 0, 0);
    if (this.selection.length === 1) {
      const id = this.selection[0]!,
        object = this.objects.get(id);
      if (object) {
        this.proxy.position.copy(object.position);
        this.proxy.rotation.copy(object.rotation);
      } else {
        const rotation = this.design.overrides.find(
          (o) => o.expressId === Number(id.slice(7)),
        )?.rotation ?? [0, 0, 0];
        this.proxy.rotation.set(
          ...(rotation.map(THREE.MathUtils.degToRad) as Point3),
        );
      }
    }
    this.syncCamera();
    const element = this.design.elements.find(
      (e) => e.id === this.selection[0],
    );
    if (
      this.editVertices &&
      this.selection.length === 1 &&
      element?.points &&
      element.kind !== "dimension"
    ) {
      this.refreshVertexHandles();
      if (this.vertexIndex !== null && element.points[this.vertexIndex]) {
        this.proxy.position.copy(
          new THREE.Vector3(...element.points[this.vertexIndex]!)
            .applyMatrix4(objectMatrix(element))
            .sub(this.engine.origin),
        );
        this.proxy.rotation.set(
          ...(element.rotation.map(THREE.MathUtils.degToRad) as Point3),
        );
        this.controls.setMode("translate");
      }
    } else this.vertexIndex = null;
    this.controls.setSpace(this.vertexIndex !== null ? "local" : "world");
    this.controls.showZ = !(
      this.vertexIndex !== null && element?.kind === "profile"
    );
    this.controls.attach(this.proxy);
    this.engine.invalidate();
  }
  focus(id: string) {
    const object = this.objects.get(id);
    if (object) {
      const center = new THREE.Box3()
          .setFromObject(object)
          .getCenter(new THREE.Vector3()),
        delta = this.engine.camera.position
          .clone()
          .sub(this.engine.controls.target);
      this.engine.controls.target.copy(center);
      this.engine.camera.position.copy(center).add(delta);
      this.engine.invalidate();
    } else if (id.startsWith("source:"))
      this.engine.fit([`${this.modelId}:${id.slice(7)}`]);
  }
  sourceCenter(expressId: number) {
    return this.engine.elements
      .get(`${this.modelId}:${expressId}`)
      ?.bounds.getCenter(new THREE.Vector3())
      .add(this.engine.origin)
      .toArray() as Point3 | undefined;
  }
  private refreshVertexHandles() {
    const e = this.design.elements.find((e) => e.id === this.selection[0]);
    if (
      !this.active ||
      !this.editVertices ||
      this.placing ||
      this.selection.length !== 1 ||
      !e?.points ||
      e.kind === "dimension"
    ) {
      this.vertexHandles.count = 0;
      return;
    }
    const closed =
      new THREE.Vector3(...e.points[0]!).distanceTo(
        new THREE.Vector3(...e.points.at(-1)!),
      ) < 1e-8;
    this.vertexHandles.count = e.points.length - (closed ? 1 : 0);
    const world = objectMatrix(e),
      r = this.worldPixel() * 6,
      scale = new THREE.Vector3(r, r, r),
      q = new THREE.Quaternion();
    for (let i = 0; i < this.vertexHandles.count; i++) {
      const point = new THREE.Vector3(...e.points[i]!)
        .applyMatrix4(world)
        .sub(this.engine.origin);
      this.vertexHandles.setMatrixAt(
        i,
        new THREE.Matrix4().compose(point, q, scale),
      );
      this.vertexHandles.setColorAt(
        i,
        new THREE.Color(i === this.vertexIndex ? "#38bdf8" : "#ffffff"),
      );
    }
    this.vertexHandles.instanceMatrix.needsUpdate = true;
    if (this.vertexHandles.instanceColor)
      this.vertexHandles.instanceColor.needsUpdate = true;
    this.vertexHandles.computeBoundingSphere();
  }
  selectionBounds(ids: string[]) {
    const bounds = new THREE.Box3();
    for (const id of ids) {
      const object = this.objects.get(id);
      if (object) bounds.union(new THREE.Box3().setFromObject(object));
      else {
        const entry = this.engine.elements.get(
          `${this.modelId}:${id.slice(7)}`,
        );
        if (entry) bounds.union(entry.bounds);
      }
    }
    return bounds.isEmpty() ? undefined : bounds;
  }
  dispose() {
    this.setActive(false);
    this.engine.designBounds.delete(this.modelId);
    this.engine.applyDesignOverrides(this.modelId, []);
    this.controls.dispose();
    this.engine.scene.remove(
      this.controls.getHelper(),
      this.group,
      this.proxy,
      this.box,
      this.preview,
      this.marker,
      this.vertexHandles,
    );
    this.box.geometry.dispose();
    (this.box.material as THREE.Material).dispose();
    this.preview.geometry.dispose();
    this.preview.material.dispose();
    this.marker.geometry.dispose();
    this.marker.material.dispose();
    this.vertexHandles.geometry.dispose();
    this.vertexHandles.material.dispose();
    for (const object of this.objects.values()) disposeDesignObject(object);
    this.engine.invalidate();
  }
}
