import * as THREE from "three";
import type { ModelScene } from "./scene";
import {
  cadViews,
  planeAxes,
  type CadView,
  type CadPlane,
} from "./cad-geometry";
type Pane = {
  view: CadView;
  element: HTMLDivElement;
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  target: THREE.Vector3;
};
/** Four cameras, one scene and one GPU allocation. Each input surface exactly
 * matches its scissored viewport, including when the inspector is resized. */
export class CadViews {
  private panes: Pane[] = [];
  private active: Pane;
  private layout: "single" | "quad" = "single";
  private abort = new AbortController();
  private observer: ResizeObserver;
  private savedCamera: ModelScene["camera"];
  private savedTarget: THREE.Vector3;
  private down = new Map<
    number,
    { x: number; y: number; moved: boolean; gizmo: boolean }
  >();
  private currentView: CadView = "3d";
  private grid = new THREE.GridHelper(100, 100, 0x64748b, 0x334155);
  private oldGrids: { object: THREE.Object3D; visible: boolean }[] = [];
  workplanes = { plane: "top" as CadPlane, offsets: [0, 0, 0], grid: true };
  private before = {
    damping: true,
    rotate: true,
    mouse: {
      LEFT: null,
      MIDDLE: null,
      RIGHT: null,
    } as typeof this.engine.controls.mouseButtons,
    touch: {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN,
    } as typeof this.engine.controls.touches,
  };
  constructor(
    private engine: ModelScene,
    private host: HTMLElement,
    private callbacks: {
      view: (view: CadView) => void;
      hover: (x: number, y: number) => void;
      tap: (x: number, y: number, extend: boolean) => void;
      key: (event: KeyboardEvent) => void;
    },
  ) {
    this.savedCamera = engine.camera;
    this.savedTarget = engine.controls.target.clone();
    this.before = {
      damping: engine.controls.enableDamping,
      rotate: engine.controls.enableRotate,
      mouse: { ...engine.controls.mouseButtons },
      touch: { ...engine.controls.touches },
    };
    engine.setNavigationPaused(true);
    engine.controls.disconnect();
    engine.controls.enableDamping = false;
    engine.labels.domElement.style.visibility = "hidden";
    this.oldGrids = engine.scene.children
      .filter((o) => o instanceof THREE.GridHelper)
      .map((object) => ({ object, visible: object.visible }));
    this.oldGrids.forEach(({ object }) => {
      object.visible = false;
    });
    (this.grid.material as THREE.Material).transparent = true;
    (this.grid.material as THREE.Material).opacity = 0.35;
    this.grid.renderOrder = -1;
    engine.scene.add(this.grid);
    const target = engine.bounds().isEmpty()
      ? new THREE.Vector3()
      : engine.bounds().getCenter(new THREE.Vector3());
    for (const view of Object.keys(cadViews) as CadView[]) {
      const camera =
        view === "3d"
          ? new THREE.PerspectiveCamera(50, 1, 0.001, 1e7)
          : new THREE.OrthographicCamera(-20, 20, 20, -20, 0.001, 1e7);
      const element = document.createElement("div");
      element.tabIndex = 0;
      element.dataset.cadView = view;
      element.setAttribute("aria-label", `${cadViews[view]} editing view`);
      element.setAttribute("role", "application");
      element.style.cssText =
        "position:relative;min-width:0;min-height:0;outline:none;touch-action:none;border:1px solid #64748b55;overflow:hidden";
      const label = document.createElement("span");
      label.textContent = cadViews[view];
      label.style.cssText =
        "position:absolute;top:8px;left:10px;pointer-events:none;font:600 11px system-ui;color:#dbeafe;background:#182534dd;border-radius:3px;padding:4px 8px";
      element.append(label);
      host.append(element);
      const pane = { view, camera, element, target: target.clone() };
      this.panes.push(pane);
      this.reset(pane, target);
      const options = { signal: this.abort.signal, capture: true };
      element.addEventListener(
        "pointerdown",
        (event) => {
          if (event.target !== element) return;
          this.activate(pane);
          element.focus({ preventScroll: true });
          const gizmo =
            event.button === 0 && Boolean(engine.editorPointer?.(event));
          if (this.down.size)
            for (const d of this.down.values()) d.moved = true;
          this.down.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
            moved: this.down.size > 0,
            gizmo,
          });
        },
        options,
      );
      element.addEventListener(
        "pointermove",
        (event) => {
          const down = this.down.get(event.pointerId);
          if (
            down &&
            Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5
          )
            down.moved = true;
          if (!event.buttons && !this.down.size) this.activate(pane);
          if (!event.buttons && !this.down.size)
            callbacks.hover(event.clientX, event.clientY);
        },
        options,
      );
      element.addEventListener(
        "pointerup",
        (event) => {
          const down = this.down.get(event.pointerId);
          this.down.delete(event.pointerId);
          if (down && !down.moved && !down.gizmo && event.button === 0)
            callbacks.tap(
              event.clientX,
              event.clientY,
              event.shiftKey || event.ctrlKey || event.metaKey,
            );
        },
        { signal: this.abort.signal },
      );
      element.addEventListener(
        "pointercancel",
        (event) => {
          this.down.delete(event.pointerId);
        },
        { signal: this.abort.signal },
      );
      element.addEventListener("wheel", () => this.activate(pane), options);
      element.addEventListener("keydown", (event) => callbacks.key(event), {
        signal: this.abort.signal,
      });
      element.addEventListener(
        "contextmenu",
        (event) => event.preventDefault(),
        { signal: this.abort.signal },
      );
    }
    this.active = this.panes[0]!;
    this.activate(this.active, true);
    engine.renderViews = this.render;
    host.style.display = "grid";
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.setLayout("single");
  }
  private activate(pane: Pane, force = false) {
    if (!force && (pane === this.active || this.down.size)) return;
    if (this.active) this.active.target.copy(this.engine.controls.target);
    this.active = pane;
    this.currentView = pane.view;
    const { controls } = this.engine;
    controls.disconnect();
    this.engine.camera = pane.camera;
    this.engine.editorInput = pane.element;
    controls.object = pane.camera;
    controls.target.copy(pane.target);
    controls.enableRotate = pane.view === "3d";
    controls.mouseButtons = {
      LEFT: pane.view === "3d" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: pane.view === "3d" ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN,
    };
    controls.touches = {
      ONE: pane.view === "3d" ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN,
      TWO: THREE.TOUCH.DOLLY_PAN,
    };
    controls.connect(pane.element);
    controls.enabled = true;
    controls.update();
    for (const p of this.panes)
      p.element.style.borderColor = p === pane ? "#7da9ce" : "#64748b55";
    this.callbacks.view(pane.view);
    this.engine.invalidate();
  }
  get view() {
    return this.currentView;
  }
  setView(view: CadView) {
    this.activate(this.panes.find((p) => p.view === view)!, true);
    this.applyLayout();
  }
  setLayout(layout: "single" | "quad") {
    this.layout = layout;
    this.applyLayout();
  }
  private applyLayout() {
    this.host.style.gridTemplateColumns =
      this.layout === "quad" ? "1fr 1fr" : "1fr";
    this.host.style.gridTemplateRows =
      this.layout === "quad" ? "1fr 1fr" : "1fr";
    for (const pane of this.panes)
      pane.element.style.display =
        this.layout === "quad" || pane === this.active ? "block" : "none";
    this.resize();
  }
  private reset(pane: Pane, target: THREE.Vector3, extent?: THREE.Box3) {
    const box = extent ?? this.engine.bounds(),
      radius = box.isEmpty()
        ? 5
        : Math.max(0.2, box.getSize(new THREE.Vector3()).length() / 2);
    pane.target.copy(target);
    const direction = {
      "3d": [1, 0.7, 1],
      top: [0, 1, 0],
      front: [0, 0, 1],
      right: [1, 0, 0],
    }[pane.view];
    pane.camera.position
      .copy(target)
      .add(
        new THREE.Vector3(...direction)
          .normalize()
          .multiplyScalar(radius * 3.5),
      );
    pane.camera.up.set(
      ...((pane.view === "top" ? [0, 0, -1] : [0, 1, 0]) as [
        number,
        number,
        number,
      ]),
    );
    pane.camera.lookAt(target);
    pane.camera.zoom = 1;
    if (pane.camera instanceof THREE.OrthographicCamera) {
      pane.camera.top = radius * 1.25;
      pane.camera.bottom = -radius * 1.25;
    }
    pane.camera.updateProjectionMatrix();
  }
  fit(point?: THREE.Vector3, extent?: THREE.Box3) {
    const target = point ?? this.engine.bounds().getCenter(new THREE.Vector3());
    for (const pane of this.panes) this.reset(pane, target, extent);
    this.engine.controls.target.copy(target);
    this.engine.controls.update();
    this.resize();
  }
  private resize() {
    for (const { element, camera } of this.panes) {
      if (!element.clientHeight) continue;
      const aspect = element.clientWidth / element.clientHeight;
      if (camera instanceof THREE.PerspectiveCamera) camera.aspect = aspect;
      else {
        const half = (camera.top - camera.bottom) / 2;
        camera.left = -half * aspect;
        camera.right = half * aspect;
      }
      camera.updateProjectionMatrix();
    }
    this.engine.invalidate();
  }
  private render = () => {
    const { renderer, scene } = this.engine,
      canvas = renderer.domElement.getBoundingClientRect();
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
    renderer.clear();
    renderer.setScissorTest(true);
    const helpers = scene.children.filter((o) => o.userData.cadActiveOnly);
    for (const pane of this.panes) {
      if (pane.element.style.display === "none") continue;
      const rect = pane.element.getBoundingClientRect(),
        x = rect.left - canvas.left,
        y = canvas.bottom - rect.bottom;
      if (rect.width <= 0 || rect.height <= 0) continue;
      const plane = pane.view === "3d" ? this.workplanes.plane : pane.view;
      const { axis } = planeAxes(plane),
        camera = pane.camera;
      const extent =
        camera instanceof THREE.OrthographicCamera
          ? (camera.top - camera.bottom) / camera.zoom
          : camera.position.distanceTo(pane.target);
      const step = 10 ** Math.floor(Math.log10(Math.max(0.0001, extent / 10)));
      this.grid.visible = this.workplanes.grid;
      this.grid.rotation.set(
        plane === "front" ? Math.PI / 2 : 0,
        0,
        plane === "right" ? -Math.PI / 2 : 0,
      );
      this.grid.scale.setScalar(step);
      this.grid.position
        .copy(pane === this.active ? this.engine.controls.target : pane.target)
        .divideScalar(step)
        .round()
        .multiplyScalar(step);
      this.grid.position.setComponent(
        axis,
        (this.workplanes.offsets[axis] ?? 0) -
          this.engine.origin.getComponent(axis),
      );
      renderer.setViewport(x, y, rect.width, rect.height);
      renderer.setScissor(x, y, rect.width, rect.height);
      for (const helper of helpers) helper.visible = pane === this.active;
      pane.camera.updateMatrixWorld();
      renderer.render(scene, pane.camera);
    }
    for (const helper of helpers) helper.visible = true;
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, canvas.width, canvas.height);
  };
  dispose() {
    this.abort.abort();
    this.observer.disconnect();
    this.down.clear();
    this.engine.setNavigationPaused(false);
    this.engine.renderViews = null;
    this.engine.editorInput = null;
    this.engine.camera = this.savedCamera;
    const { controls } = this.engine;
    controls.disconnect();
    controls.object = this.savedCamera;
    controls.target.copy(this.savedTarget);
    controls.enableDamping = this.before.damping;
    controls.enableRotate = this.before.rotate;
    controls.mouseButtons = this.before.mouse;
    controls.touches = this.before.touch;
    controls.connect(this.engine.renderer.domElement);
    controls.enabled = true;
    controls.update();
    this.engine.labels.domElement.style.visibility = "";
    this.engine.scene.remove(this.grid);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.oldGrids.forEach(({ object, visible }) => {
      object.visible = visible;
    });
    for (const pane of this.panes) pane.element.remove();
    this.engine.invalidate();
  }
}
