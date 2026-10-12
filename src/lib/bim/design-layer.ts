import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { ModelScene } from "./scene";
import type { ModelDesign, DesignKind } from "./design";
import { designObject, disposeDesignObject } from "./design-geometry";
export class DesignLayer {
  readonly group = new THREE.Group();
  private objects = new Map<string, THREE.Group>();
  private design: ModelDesign = { elements: [], overrides: [] };
  private selected: string | null = null;
  private controls: TransformControls;
  private proxy = new THREE.Object3D();
  private box = new THREE.BoxHelper(new THREE.Object3D(), 0x38bdf8);
  private active = false;
  private placementKind: DesignKind | null = null;
  private pipeStart: THREE.Vector3 | null = null;
  private startMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x38bdf8 }),
  );
  get placing() {
    return this.placementKind;
  }
  set placing(value: DesignKind | null) {
    if (value !== this.placementKind) {
      this.pipeStart = null;
      this.startMarker.visible = false;
    }
    this.placementKind = value;
  }

  elevation = 0;
  snap = 0.05;
  constructor(
    readonly engine: ModelScene,
    readonly modelId: string,
    readonly callbacks: {
      select: (id: string | null) => void;
      place: (
        kind: DesignKind,
        point: [number, number, number],
        end?: [number, number, number],
      ) => void;
      transform: (
        id: string,
        position: [number, number, number],
        rotation: [number, number, number],
      ) => void;
    },
  ) {
    engine.scene.add(this.group, this.proxy, this.box, this.startMarker);
    this.startMarker.visible = false;
    this.box.visible = false;
    this.controls = new TransformControls(
      engine.camera,
      engine.renderer.domElement,
    );
    this.controls.enabled = false;
    this.controls.setSpace("world");
    engine.scene.add(this.controls.getHelper());
    this.controls.addEventListener("change", engine.invalidate);
    this.controls.addEventListener("dragging-changed", (e) => {
      engine.controls.enabled = !e.value;
      if (!e.value && this.selected) {
        const pos = this.proxy.position.clone().add(engine.origin);
        callbacks.transform(
          this.selected,
          pos.toArray() as [number, number, number],
          [
            this.proxy.rotation.x,
            this.proxy.rotation.y,
            this.proxy.rotation.z,
          ].map(THREE.MathUtils.radToDeg) as [number, number, number],
        );
      }
    });
    this.controls.addEventListener("objectChange", () => {
      const object = this.selected
        ? this.objects.get(this.selected)
        : undefined;
      if (object) {
        object.position.copy(this.proxy.position);
        object.rotation.copy(this.proxy.rotation);
        this.box.setFromObject(object);
      }
      engine.invalidate();
    });
  }
  setDesign(design: ModelDesign) {
    this.design = design;
    for (const object of this.objects.values()) {
      this.group.remove(object);
      disposeDesignObject(object);
    }
    this.objects.clear();
    for (const element of design.elements) {
      const object = designObject(element);
      object.position.sub(this.engine.origin);
      this.group.add(object);
      this.objects.set(element.id, object);
    }
    this.engine.designBounds.set(
      this.modelId,
      new THREE.Box3().setFromObject(this.group),
    );
    this.engine.applyDesignOverrides(this.modelId, design.overrides);
    this.select(this.selected);
    this.engine.invalidate();
  }
  setActive(active: boolean) {
    this.active = active;
    this.controls.enabled = active;
    if (active) {
      this.engine.editorTap = this.tap;
      this.engine.editorPointer = this.pointer;
    } else if (this.engine.editorTap === this.tap) {
      this.engine.editorTap = null;
      this.engine.editorPointer = null;
      this.engine.controls.enabled = true;
    }
    this.select(active ? this.selected : null);
  }
  setMode(mode: "translate" | "rotate") {
    this.controls.setMode(mode);
    this.controls.setTranslationSnap(this.snap || null);
    this.controls.setRotationSnap(Math.PI / 12);
    this.engine.invalidate();
  }
  private pointer = (event: PointerEvent) => {
    if (!this.active || this.placing || !this.selected) return false;
    this.controls.camera = this.engine.camera;
    const rect = this.engine.renderer.domElement.getBoundingClientRect();
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
  private tap = (x: number, y: number) => {
    const ray = this.engine.editorRay(x, y);
    this.group.updateMatrixWorld(true);
    const newHit = ray.intersectObject(this.group, true)[0];
    const source = this.engine.editorHit(x, y);
    if (this.placing) {
      const point =
        source?.point ??
        ray.ray
          .intersectPlane(
            new THREE.Plane(
              new THREE.Vector3(0, 1, 0),
              -(this.elevation - this.engine.origin.y),
            ),
            new THREE.Vector3(),
          )
          ?.add(this.engine.origin);
      if (point) {
        if (this.snap)
          point.set(
            Math.round(point.x / this.snap) * this.snap,
            Math.round(point.y / this.snap) * this.snap,
            Math.round(point.z / this.snap) * this.snap,
          );
        if (this.placing === "pipe" || this.placing === "duct") {
          if (!this.pipeStart) {
            this.pipeStart = point.clone();
            this.startMarker.position.copy(point).sub(this.engine.origin);
            this.startMarker.visible = true;
            this.engine.invalidate();
            return;
          }
          if (this.pipeStart.distanceTo(point) < 0.001) return;
          this.callbacks.place(
            this.placing,
            this.pipeStart.toArray() as [number, number, number],
            point.toArray() as [number, number, number],
          );
          this.pipeStart = null;
          this.startMarker.visible = false;
        } else
          this.callbacks.place(
            this.placing,
            point.toArray() as [number, number, number],
          );
      }
      return;
    }
    if (
      newHit &&
      (!source ||
        newHit.distance <
          ray.ray.origin.distanceTo(
            source.point.clone().sub(this.engine.origin),
          ))
    ) {
      let o: THREE.Object3D | null = newHit.object;
      while (o && !o.userData.designId) o = o.parent;
      const id = o?.userData.designId as string | undefined;
      this.callbacks.select(id ?? null);
    } else
      this.callbacks.select(
        source?.element.modelId === this.modelId
          ? `source:${source.element.expressId}`
          : null,
      );
  };
  select(id: string | null) {
    this.selected = id;
    this.controls.detach();
    this.box.visible = false;
    if (!id || !this.active) return;
    const object = this.objects.get(id);
    if (object) {
      this.proxy.position.copy(object.position);
      this.proxy.rotation.copy(object.rotation);
      this.box.setFromObject(object);
      this.box.visible = true;
    } else if (id.startsWith("source:")) {
      const entry = this.engine.elements.get(`${this.modelId}:${id.slice(7)}`);
      if (!entry) return;
      const center = entry.bounds.getCenter(new THREE.Vector3());
      this.proxy.position.copy(center);
      const rotation = this.design.overrides.find(
        (o) => o.expressId === Number(id.slice(7)),
      )?.rotation ?? [0, 0, 0];
      this.proxy.rotation.set(
        ...(rotation.map(THREE.MathUtils.degToRad) as [number, number, number]),
      );
      // Imported assemblies retain their original geometry; edit their placement as a unit.
    } else return;
    this.controls.attach(this.proxy);
    this.engine.invalidate();
  }
  focus(id: string) {
    const object = this.objects.get(id);
    if (object) {
      const center = new THREE.Box3()
        .setFromObject(object)
        .getCenter(new THREE.Vector3());
      const delta = this.engine.camera.position
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
      .toArray() as [number, number, number] | undefined;
  }
  dispose() {
    this.setActive(false);
    this.engine.designBounds.delete(this.modelId);
    this.engine.applyDesignOverrides(this.modelId, []);
    this.engine.scene.remove(this.startMarker);
    this.startMarker.geometry.dispose();
    this.startMarker.material.dispose();
    this.controls.dispose();
    this.engine.scene.remove(
      this.controls.getHelper(),
      this.group,
      this.proxy,
      this.box,
    );
    this.box.geometry.dispose();
    (this.box.material as THREE.Material).dispose();
    for (const object of this.objects.values()) disposeDesignObject(object);
    this.engine.invalidate();
  }
}
