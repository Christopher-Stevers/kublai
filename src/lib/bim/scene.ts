import type { CadMesh, DesignOverride } from "./design";
import { navigationDelta } from "./navigation";
import {
  DEFAULT_NAVIGATION,
  boundActions,
  mouseAction,
  navigationKey,
  type NavigationAction,
  type NavigationSettings,
  type MouseAction,
  type ThumbSide,
} from "./navigation-settings";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CSS2DRenderer,
  CSS2DObject,
} from "three/addons/renderers/CSS2DRenderer.js";
import type {
  BimElement,
  BimIssue,
  BimMeasurement,
  BimViewState,
  Point3,
} from "./types";
import { elementKey } from "./types";
import type { IfcPart } from "./worker-protocol";
import { modelMemoryBudget, planModelBatches } from "./model-memory";
import { SpatialModelPicker } from "./spatial-picker";
import { formatModelMeasure, measureArea, measureDistance } from "./geometry";
export type TouchJoystick = {
  side: ThumbSide;
  x: number;
  y: number;
  dx: number;
  dy: number;
};
export type ModelTool = "inspect" | "distance" | "area" | "pin" | "walk";
type PartRef = {
  batch: THREE.BatchedMesh;
  index: number;
  color: THREE.Vector4;
};
type ElementState = { info: BimElement; parts: PartRef[]; bounds: THREE.Box3 };
const tuple = (p: THREE.Vector3): Point3 => [p.x, p.y, p.z];
export class ModelScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly labels = new CSS2DRenderer();
  readonly perspective = new THREE.PerspectiveCamera(50, 1, 0.01, 1e7);
  readonly orthographic = new THREE.OrthographicCamera(
    -20,
    20,
    20,
    -20,
    0.01,
    1e7,
  );
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  readonly controls: OrbitControls;
  readonly elements = new Map<string, ElementState>();
  readonly models = new Map<string, THREE.BatchedMesh[]>();
  readonly origin = new THREE.Vector3();
  private originSet = false;
  private modelBytes = new Map<string, number>();
  private geometryBytes = 0;
  private readonly memoryBudget = modelMemoryBudget(
    (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    window.matchMedia("(pointer: coarse)").matches,
  );
  private batches: THREE.BatchedMesh[] = [];
  private batchKeys = new Map<THREE.BatchedMesh, Map<number, string>>();
  private picker = new SpatialModelPicker();
  readonly designBounds = new Map<string, THREE.Box3>();
  private designDeleted = new Set<string>();
  private designOriginals = new Map<
    string,
    { matrices: THREE.Matrix4[]; bounds: THREE.Box3; name: string }
  >();
  editorTap: ((x: number, y: number) => void) | null = null;
  editorPointer: ((event: PointerEvent) => boolean) | null = null;
  // CAD uses one renderer and one shared scene, with independent camera views.
  editorInput: HTMLElement | null = null;
  renderViews: (() => void) | null = null;
  inputRect() {
    return (
      this.editorInput ?? this.renderer.domElement
    ).getBoundingClientRect();
  }
  editorRay(x: number, y: number) {
    const rect = this.inputRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        (-(y - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return ray;
  }
  editorHit(x: number, y: number) {
    const hit = this.pick(x, y);
    return hit
      ? {
          element: this.elements.get(hit.key)!.info,
          point: hit.point.clone().add(this.origin),
        }
      : null;
  }
  editorAnchor(x: number, y: number) {
    const hit = this.pick(x, y);
    if (!hit) return null;
    const point = this.snapVertex(hit, x, y);
    return point === hit.point
      ? null
      : {
          point: point.clone().add(this.origin),
          kind: "Model vertex",
        };
  }
  /** Snapshot an edited IFC element in world metres, without exposing GPU buffers. */
  editorGeometry(
    modelId: string,
    expressId: number,
    origin: Point3 = [0, 0, 0],
  ): CadMesh[] {
    const key = elementKey(modelId, expressId),
      entry = this.elements.get(key);
    if (!entry || this.designDeleted.has(key)) return [];
    return entry.parts.map(({ batch, index }) => {
      const range = batch.getGeometryRangeAt(batch.getGeometryIdAt(index));
      if (!range)
        throw Error("Model geometry is no longer available. Reload the model.");
      const geometry = batch.geometry,
        attribute = geometry.getAttribute("position"),
        matrix = batch
          .getMatrixAt(index, new THREE.Matrix4())
          .premultiply(batch.matrixWorld),
        positions: number[] = [],
        indices: number[] = [],
        point = new THREE.Vector3(),
        shift = this.origin.clone().sub(new THREE.Vector3(...origin));
      for (
        let i = range.vertexStart;
        i < range.vertexStart + range.vertexCount;
        i++
      ) {
        point.fromBufferAttribute(attribute, i).applyMatrix4(matrix).add(shift);
        positions.push(point.x, point.y, point.z);
      }
      for (
        let i = range.indexStart;
        i < range.indexStart + range.indexCount;
        i++
      )
        indices.push(geometry.index!.getX(i) - range.vertexStart);
      if (matrix.determinant() < 0)
        for (let i = 0; i < indices.length; i += 3)
          [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!];
      return { positions, indices };
    });
  }
  applyDesignOverrides(modelId: string, overrides: DesignOverride[]) {
    const changed = new Set<THREE.BatchedMesh>();
    for (const [key, original] of this.designOriginals) {
      if (!key.startsWith(modelId + ":")) continue;
      const entry = this.elements.get(key);
      if (!entry) continue;
      entry.parts.forEach((part, i) => {
        part.batch.setMatrixAt(part.index, original.matrices[i]!);
        changed.add(part.batch);
      });
      entry.bounds.copy(original.bounds);
      entry.info.name = original.name;
      this.designDeleted.delete(key);
    }
    for (const override of overrides) {
      const key = elementKey(modelId, override.expressId),
        entry = this.elements.get(key);
      if (!entry) continue;
      if (!this.designOriginals.has(key))
        this.designOriginals.set(key, {
          matrices: entry.parts.map((p) =>
            p.batch.getMatrixAt(p.index, new THREE.Matrix4()),
          ),
          bounds: entry.bounds.clone(),
          name: entry.info.name,
        });
      const original = this.designOriginals.get(key)!;
      const center = original.bounds.getCenter(new THREE.Vector3());
      const transform = new THREE.Matrix4()
        .makeTranslation(...override.translation)
        .multiply(
          new THREE.Matrix4().makeTranslation(center.x, center.y, center.z),
        )
        .multiply(
          new THREE.Matrix4().makeRotationFromEuler(
            new THREE.Euler(
              ...(override.rotation.map(THREE.MathUtils.degToRad) as [
                number,
                number,
                number,
              ]),
            ),
          ),
        )
        .multiply(
          new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z),
        );
      entry.parts.forEach((part, i) => {
        part.batch.setMatrixAt(
          part.index,
          transform.clone().multiply(original.matrices[i]!),
        );
        changed.add(part.batch);
      });
      entry.bounds.copy(original.bounds).applyMatrix4(transform);
      if (override.name) entry.info.name = override.name;
      if (override.deleted) this.designDeleted.add(key);
    }
    for (const batch of changed) {
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.picker.add(batch, this.batchKeys.get(batch)!.keys());
    }
    this.updateVisibility();
  }
  private selected: string | null = null;
  private hidden = new Set<string>();
  private isolated = new Set<string>();
  private categories = new Set<string>();
  private levels = new Set<string>();
  private section: BimViewState["section"] = null;
  private sectionBox: BimViewState["sectionBox"] = null;
  private clipping: THREE.Plane[] = [];
  private xray = false;
  private units: "metric" | "imperial" = "metric";
  private tool: ModelTool = "inspect";
  private draft: THREE.Vector3[] = [];
  private measures: BimMeasurement[] = [];
  private measureGroup = new THREE.Group();
  private issueGroup = new THREE.Group();
  private grid: THREE.GridHelper;
  private frame = 0;
  private destroyed = false;
  private width = 1;
  private height = 1;
  private keys = new Set<NavigationAction>();
  private pressedCodes = new Set<string>();
  private touchSticks = new Map<
    number,
    TouchJoystick & {
      clientX: number;
      clientY: number;
      moved: boolean;
      started: number;
    }
  >();
  private touchListeners = new Set<(sticks: TouchJoystick[]) => void>();
  subscribeTouchJoysticks(listener: (sticks: TouchJoystick[]) => void) {
    this.touchListeners.add(listener);
    listener([...this.touchSticks.values()]);
    return () => {
      this.touchListeners.delete(listener);
    };
  }
  private publishTouchSticks() {
    const sticks = [...this.touchSticks.values()];
    for (const listener of this.touchListeners) listener(sticks);
  }
  private floatingTouchEnabled() {
    return (
      this.navigation.touch.display !== "off" &&
      (this.navigation.touch.display === "always" ||
        this.tool === "walk" ||
        matchMedia("(pointer: coarse)").matches)
    );
  }
  private thumbs = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
  private navigation = DEFAULT_NAVIGATION;
  private navigationPaused = false;
  private lastTime = 0;
  private start: {
    x: number;
    y: number;
    id: number;
    action: MouseAction;
    canSelect: boolean;
  } | null = null;
  private pointers = new Set<number>();
  private gestureMoved = false;
  private gestureDistance = 0;
  private animation: {
    start: number;
    from: THREE.Vector3;
    to: THREE.Vector3;
    targetFrom: THREE.Vector3;
    targetTo: THREE.Vector3;
  } | null = null;
  private resize: ResizeObserver;
  private abort = new AbortController();
  constructor(
    private host: HTMLElement,
    private callbacks: {
      select: (element: BimElement | null, point?: Point3) => void;
      pin: (element: BimElement, point: Point3) => void;
      measurement: (measures: BimMeasurement[]) => void;
      error: (message: string) => void;
      issue: (id: string) => void;
    },
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Keep bright/white BIM surfaces shaded instead of clipping them to white.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.localClippingEnabled = true;
    this.renderer.domElement.className =
      "absolute inset-0 h-full w-full outline-none";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D construction model",
    );
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);
    this.labels.domElement.style.cssText =
      "position:absolute;inset:0;pointer-events:none;overflow:hidden";
    host.appendChild(this.labels.domElement);
    this.scene.background = new THREE.Color("#edf1f5");
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x748094, 1));
    const light = new THREE.DirectionalLight(0xffffff, 2.8);
    light.position.set(15, 30, 20);
    this.scene.add(light);
    const fill = new THREE.DirectionalLight(0xd5e2ff, 1);
    fill.position.set(-20, 12, -20);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(100, 100, 0xa8b4c3, 0xd8dfe7);
    this.scene.add(this.grid, this.measureGroup, this.issueGroup);
    this.perspective.position.set(22, 16, 22);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.15;
    this.controls.screenSpacePanning = true;
    // Desktop navigation uses configurable gestures; OrbitControls handles touch.
    this.controls.mouseButtons.LEFT = null;
    this.controls.mouseButtons.MIDDLE = null;
    this.controls.mouseButtons.RIGHT = null;
    this.controls.addEventListener("change", this.invalidate);
    const signal = this.abort.signal;
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", this.pointerDown, {
      signal,
      capture: true,
    });
    canvas.addEventListener("wheel", this.wheel, {
      signal,
      capture: true,
      passive: false,
    });
    canvas.addEventListener("pointermove", this.pointerMove, { signal });
    canvas.addEventListener("pointerup", this.pointerUp, { signal });
    canvas.addEventListener("pointercancel", this.pointerCancel, { signal });
    canvas.addEventListener("lostpointercapture", this.pointerCancel, {
      signal,
    });
    canvas.addEventListener("keydown", this.keyDown, { signal });
    canvas.addEventListener("keyup", this.keyUp, { signal });
    canvas.addEventListener("blur", this.clearNavigationInput, { signal });
    window.addEventListener("blur", this.clearNavigationInput, { signal });
    document.addEventListener("visibilitychange", this.clearNavigationInput, {
      signal,
    });
    canvas.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        this.callbacks.error(
          "The device paused 3D rendering. Close this view and reopen fewer models.",
        );
      },
      { signal },
    );
    this.resize = new ResizeObserver(() => this.resizeView());
    this.resize.observe(host);
    this.resizeView();
  }
  private resizeView() {
    this.width = Math.max(1, this.host.clientWidth);
    this.height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(this.width, this.height);
    this.labels.setSize(this.width, this.height);
    this.perspective.aspect = this.width / this.height;
    this.perspective.updateProjectionMatrix();
    const half = (this.orthographic.top - this.orthographic.bottom) / 2;
    this.orthographic.left = (-half * this.width) / this.height;
    this.orthographic.right = (half * this.width) / this.height;
    this.orthographic.updateProjectionMatrix();
    this.invalidate();
  }
  invalidate = () => {
    if (!this.destroyed && !this.frame)
      this.frame = requestAnimationFrame(this.render);
  };
  private render = (now: number) => {
    this.frame = 0;
    const dt = Math.min(0.05, (now - this.lastTime) / 1000 || 0.016);
    this.lastTime = now;
    if (this.animation) {
      const a = this.animation;
      const t = Math.min(1, (now - a.start) / 280),
        k = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(a.from, a.to, k);
      this.controls.target.lerpVectors(a.targetFrom, a.targetTo, k);
      if (t === 1) this.animation = null;
    }
    const thumbsActive = this.applyThumbs(dt);
    if (this.keys.size) {
      const delta = navigationDelta(
        this.camera.quaternion,
        this.keys,
        dt,
        this.navigation,
      );
      this.camera.position.add(delta);
      this.controls.target.add(delta);
    }
    const moved = this.controls.enabled && this.controls.update();
    this.camera.updateMatrixWorld();
    if (this.renderViews) this.renderViews();
    else {
      this.renderer.render(this.scene, this.camera);
      this.labels.render(this.scene, this.camera);
    }
    if (moved || this.animation || this.keys.size || thumbsActive)
      this.invalidate();
  };
  setDark(dark: boolean) {
    this.scene.background = new THREE.Color(dark ? "#151c26" : "#edf1f5");
    this.grid.visible = !dark || this.elements.size > 0;
    this.invalidate();
  }
  setOrigin(origin: Point3) {
    if (
      this.elements.size &&
      this.origin.distanceTo(new THREE.Vector3(...origin)) > 0.001
    )
      throw Error(
        "Close the loaded models before restoring a different coordinate origin.",
      );
    this.origin.fromArray(origin);
    this.originSet = true;
  }
  addParts(modelId: string, parts: IfcPart[], elements: BimElement[]) {
    const groups = planModelBatches(parts);
    const addedBytes = groups.reduce((sum, group) => sum + group.bytes, 0);
    if (this.geometryBytes + addedBytes > this.memoryBudget)
      throw Error(
        "The open models exceed this device's geometry memory budget. Close another model or use a floor or trade export.",
      );
    this.geometryBytes += addedBytes;
    this.modelBytes.set(
      modelId,
      (this.modelBytes.get(modelId) ?? 0) + addedBytes,
    );
    for (const info of elements) {
      const existing = this.elements.get(info.key);
      if (existing) existing.info = info;
      else
        this.elements.set(info.key, {
          info,
          parts: [],
          bounds: new THREE.Box3(),
        });
    }
    const changed = new Set<string>();
    for (const { group, transparent, vertices, indices } of groups) {
      const material = new THREE.MeshStandardMaterial({
        roughness: 0.8,
        metalness: 0,
        side: THREE.DoubleSide,
        transparent: transparent || this.xray,
        opacity: this.xray ? 0.2 : 1,
        depthWrite: !this.xray,
        clippingPlanes: this.clipping,
      });
      const batch = new THREE.BatchedMesh(
        group.length,
        vertices,
        indices,
        material,
      );
      const lookup = new Map<number, string>();
      const geometries = new Map<number, { id: number; bounds: THREE.Box3 }>();
      // Register ownership before filling: removeModel also cleans up a failed chunk.
      this.scene.add(batch);
      this.batches.push(batch);
      this.batchKeys.set(batch, lookup);
      this.models.set(modelId, [...(this.models.get(modelId) ?? []), batch]);
      for (const part of group) {
        let geometry = geometries.get(part.geometryId);
        if (!geometry) {
          const buffer = new THREE.BufferGeometry();
          buffer.setAttribute(
            "position",
            new THREE.BufferAttribute(part.positions, 3),
          );
          buffer.setAttribute(
            "normal",
            new THREE.BufferAttribute(part.normals, 3, true),
          );
          buffer.setIndex(new THREE.BufferAttribute(part.indices, 1));
          buffer.computeBoundingBox();
          geometry = {
            id: batch.addGeometry(buffer),
            bounds: buffer.boundingBox!.clone(),
          };
          geometries.set(part.geometryId, geometry);
          buffer.dispose();
        }
        const matrix = new THREE.Matrix4().fromArray(part.matrix);
        const world = geometry.bounds.clone().applyMatrix4(matrix);
        if (!this.originSet) {
          const center = world.getCenter(new THREE.Vector3());
          this.origin.set(
            Math.round(center.x / 1000) * 1000,
            Math.round(center.y / 1000) * 1000,
            Math.round(center.z / 1000) * 1000,
          );
          this.originSet = true;
        }
        matrix.elements[12] -= this.origin.x;
        matrix.elements[13] -= this.origin.y;
        matrix.elements[14] -= this.origin.z;
        const instance = batch.addInstance(geometry.id);
        batch.setMatrixAt(instance, matrix);
        const color = new THREE.Vector4(...part.color);
        batch.setColorAt(instance, color);
        const key = elementKey(modelId, part.expressId);
        lookup.set(instance, key);
        changed.add(key);
        let element = this.elements.get(key);
        if (!element) {
          element = {
            info: {
              key,
              modelId,
              expressId: part.expressId,
              guid: "",
              name: `Element ${part.expressId}`,
              type: "IFCELEMENT",
              level: "",
              levelName: "Unassigned",
            },
            parts: [],
            bounds: new THREE.Box3(),
          };
          this.elements.set(key, element);
        }
        element.parts.push({ batch, index: instance, color });
        world.min.sub(this.origin);
        world.max.sub(this.origin);
        element.bounds.union(world);
      }
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      this.picker.add(batch, lookup.keys());
    }
    this.updateVisibility(changed);
    this.invalidate();
  }
  finishModel(modelId: string, elements: BimElement[]) {
    for (const info of elements) {
      const entry = this.elements.get(info.key);
      if (entry) entry.info = info;
    }
    this.updateVisibility();
    const bounds = this.bounds();
    if (!bounds.isEmpty()) {
      this.grid.position.y = bounds.min.y - 0.03;
      const width = Math.max(
        bounds.max.x - bounds.min.x,
        bounds.max.z - bounds.min.z,
        20,
      );
      this.grid.scale.setScalar(Math.max(1, width / 80));
      this.camera.far = Math.max(
        10000,
        bounds.getSize(new THREE.Vector3()).length() * 100,
      );
      this.camera.updateProjectionMatrix();
    }
    this.invalidate();
  }
  removeModel(modelId: string) {
    this.designBounds.delete(modelId);
    this.geometryBytes -= this.modelBytes.get(modelId) ?? 0;
    this.modelBytes.delete(modelId);
    const batches = this.models.get(modelId) ?? [];
    for (const batch of batches) {
      this.picker.remove(batch);
      this.scene.remove(batch);
      batch.dispose();
      batch.material.dispose();
      this.batchKeys.delete(batch);
    }
    this.batches = this.batches.filter((b) => !batches.includes(b));
    this.models.delete(modelId);
    const prefix = modelId + ":";
    for (const key of this.designOriginals.keys())
      if (key.startsWith(prefix)) this.designOriginals.delete(key);
    for (const key of this.designDeleted)
      if (key.startsWith(prefix)) this.designDeleted.delete(key);
    for (const set of [this.hidden, this.isolated, this.levels])
      for (const key of set) if (key.startsWith(prefix)) set.delete(key);
    for (const [key, entry] of this.elements)
      if (entry.info.modelId === modelId) this.elements.delete(key);
    if (this.selected && !this.elements.has(this.selected)) this.select(null);
    if (!this.elements.size) this.originSet = false;
    this.invalidate();
  }
  bounds(keys?: Iterable<string>) {
    const box = new THREE.Box3();
    for (const key of keys ?? this.elements.keys()) {
      const e = this.elements.get(key);
      if (e) box.union(e.bounds);
    }
    if (!keys)
      for (const bounds of this.designBounds.values()) box.union(bounds);
    return box;
  }
  fit(keys?: Iterable<string>, animate = true) {
    const box = this.bounds(keys);
    if (box.isEmpty()) return;
    const target = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.2);
    const direction = this.camera.position
      .clone()
      .sub(this.controls.target)
      .normalize();
    if (!direction.length()) direction.set(1, 0.7, 1).normalize();
    const distance =
      ((radius / Math.sin(THREE.MathUtils.degToRad(25))) * 1.25) /
      Math.min(1, this.width / this.height);
    const to = target.clone().addScaledVector(direction, distance);
    if (this.camera === this.orthographic) {
      const h = (radius * 1.3) / Math.min(1, this.width / this.height);
      this.orthographic.top = h;
      this.orthographic.bottom = -h;
      this.resizeView();
    }
    this.camera.near = Math.max(0.005, radius / 10000);
    this.camera.far = Math.max(10000, distance * 100);
    this.camera.updateProjectionMatrix();
    if (animate)
      this.animation = {
        start: performance.now(),
        from: this.camera.position.clone(),
        to,
        targetFrom: this.controls.target.clone(),
        targetTo: target,
      };
    else {
      this.camera.position.copy(to);
      this.controls.target.copy(target);
      this.controls.update();
    }
    this.invalidate();
  }
  preset(name: "iso" | "top" | "front" | "left" | "right") {
    const center = this.bounds().getCenter(new THREE.Vector3());
    const directions = {
      iso: new THREE.Vector3(1, 0.7, 1),
      top: new THREE.Vector3(0, 1, 0.0001),
      front: new THREE.Vector3(0, 0, 1),
      left: new THREE.Vector3(-1, 0, 0),
      right: new THREE.Vector3(1, 0, 0),
    };
    this.camera.up.set(0, 1, 0);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(directions[name]);
    if (name === "top") this.setProjection("orthographic");
    this.fit(undefined, false);
  }
  setProjection(type: BimViewState["projection"]) {
    const next = type === "perspective" ? this.perspective : this.orthographic;
    if (next === this.camera) return;
    next.position.copy(this.camera.position);
    next.up.copy(this.camera.up);
    if (next === this.orthographic) {
      const half =
        this.camera.position.distanceTo(this.controls.target) *
        Math.tan(THREE.MathUtils.degToRad(25));
      this.orthographic.top = half;
      this.orthographic.bottom = -half;
    }
    this.camera = next;
    this.controls.object = next;
    this.resizeView();
    this.controls.update();
    this.invalidate();
  }
  setTool(tool: ModelTool) {
    this.tool = tool;
    this.start = null;
    this.draft = [];
    this.clearNavigationInput();
    this.controls.enabled = !this.navigationPaused;
    this.controls.enableRotate = tool !== "walk";
    if (tool === "walk") {
      this.setProjection("perspective");
      this.camera.up.set(0, 1, 0);
    }
    this.renderer.domElement.focus({ preventScroll: true });
    this.renderer.domElement.style.cursor =
      tool === "pin" ? "crosshair" : tool === "inspect" ? "grab" : "crosshair";
    this.drawMeasurements();
    this.invalidate();
  }
  setNavigationSettings(settings: NavigationSettings) {
    this.clearNavigationInput();
    this.navigation = settings;
    this.controls.enableDamping = settings.smoothing;
    this.controls.rotateSpeed = settings.lookSensitivity;
    this.controls.panSpeed = settings.panSensitivity;
    this.controls.zoomSpeed = settings.zoomSensitivity;
    this.invalidate();
  }
  setNavigationPaused(paused: boolean) {
    this.navigationPaused = paused;
    this.clearNavigationInput();
    this.controls.enabled = !paused;
  }
  private clearNavigationInput = () => {
    this.touchSticks.clear();
    this.publishTouchSticks();
    this.keys.clear();
    this.pressedCodes.clear();
    this.thumbs = { left: { x: 0, y: 0 }, right: { x: 0, y: 0 } };
    this.start = null;
    this.pointers.clear();
  };
  private updateNavigationKeys() {
    this.keys = boundActions(this.navigation, this.pressedCodes);
    this.invalidate();
  }
  setThumb(side: ThumbSide, x: number, y: number) {
    if (this.navigationPaused || this.navigation.touch.display === "off")
      return;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const length = Math.max(1, Math.hypot(x, y));
    this.thumbs[side] = { x: x / length, y: y / length };
    this.animation = null;
    this.invalidate();
  }
  private applyThumbs(seconds: number) {
    if (this.navigationPaused) return false;
    const dt = Math.min(0.05, Math.max(0, seconds));
    let active = false;
    const delta = new THREE.Vector3();
    for (const side of ["left", "right"] as const) {
      const { x, y } = this.thumbs[side];
      const action = this.navigation.touch[side];
      if ((!x && !y) || action === "none") continue;
      active = true;
      const horizontal = x * dt * 1.8 * this.navigation.touch.sensitivity;
      const vertical =
        y *
        dt *
        1.8 *
        this.navigation.touch.sensitivity *
        (this.navigation.touch.invertY ? -1 : 1);
      if (action === "look") {
        const rotation = new THREE.Euler().setFromQuaternion(
          this.camera.quaternion,
          "YXZ",
        );
        rotation.y -= horizontal;
        rotation.x = THREE.MathUtils.clamp(
          rotation.x - vertical,
          -Math.PI * 0.48,
          Math.PI * 0.48,
        );
        const distance = Math.max(
          0.01,
          this.camera.position.distanceTo(this.controls.target),
        );
        this.camera.quaternion.setFromEuler(rotation);
        this.controls.target
          .copy(this.camera.position)
          .addScaledVector(
            new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion),
            distance,
          );
      } else if (action === "orbit") {
        const spherical = new THREE.Spherical().setFromVector3(
          this.camera.position.clone().sub(this.controls.target),
        );
        spherical.theta -= horizontal;
        spherical.phi -= vertical;
        spherical.makeSafe();
        this.camera.position
          .copy(this.controls.target)
          .add(new THREE.Vector3().setFromSpherical(spherical));
        this.camera.lookAt(this.controls.target);
      } else if (action === "zoom") {
        this.zoomBy(Math.exp(y * dt * 2 * this.navigation.touch.sensitivity));
      }
    }
    if (!active) return false;
    // Translate after steering so both thumbs work together in either handedness.
    for (const side of ["left", "right"] as const) {
      const { x, y } = this.thumbs[side];
      const action = this.navigation.touch[side];
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
        this.camera.quaternion,
      );
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
        this.camera.quaternion,
      );
      if (action === "move" && this.navigation.movement === "ground") {
        right.y = 0;
        right.normalize();
        forward.crossVectors(new THREE.Vector3(0, 1, 0), right);
      }
      if (action === "move" || action === "fly") {
        delta.addScaledVector(forward, -y);
        if (action === "move") delta.addScaledVector(right, x);
      } else if (action === "elevation") {
        delta.addScaledVector(right, x);
        delta.y -= y;
      } else if (action === "pan") {
        delta
          .addScaledVector(right, x)
          .addScaledVector(
            new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion),
            -y,
          );
      }
    }
    delta.clampLength(0, 1).multiplyScalar(dt * this.navigation.moveSpeed);
    this.camera.position.add(delta);
    this.controls.target.add(delta);
    return active;
  }
  private keyDown = (event: KeyboardEvent) => {
    if (
      this.navigationPaused ||
      event.isComposing ||
      (event.target as HTMLElement).closest(
        "input,textarea,select,[contenteditable='true']",
      )
    )
      return;
    if (event.ctrlKey || event.metaKey || event.altKey) {
      this.clearNavigationInput();
      return; // Browser/OS shortcuts always retain their meaning.
    }
    if (event.key === "Escape") {
      this.clearNavigationInput();
      this.draft = [];
      this.drawMeasurements();
      this.select(null);
      return;
    }
    const code = navigationKey(event);
    const actions = boundActions(this.navigation, new Set([code]));
    if (!actions.size) return;
    event.preventDefault();
    for (const action of actions) {
      if (
        ["fit", "focus", "iso", "top", "front", "rightView"].includes(action)
      ) {
        if (!event.repeat) {
          if (action === "fit") this.fit();
          else if (action === "focus") {
            if (this.selected) this.fit([this.selected]);
          } else
            this.preset(
              action === "rightView"
                ? "right"
                : (action as "iso" | "top" | "front"),
            );
        }
      } else {
        this.animation = null;
        this.pressedCodes.add(code);
        this.updateNavigationKeys();
      }
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    this.pressedCodes.delete(navigationKey(event));
    this.updateNavigationKeys();
  };
  private zoomBy(factor: number) {
    const distance = this.camera.position.distanceTo(this.controls.target);
    if (this.camera instanceof THREE.PerspectiveCamera) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      if (distance < 0.00001)
        offset.set(0, 0, 1).applyQuaternion(this.camera.quaternion);
      offset.setLength(
        THREE.MathUtils.clamp(Math.max(0.01, distance) * factor, 0.01, 1e7),
      );
      this.camera.position.copy(this.controls.target).add(offset);
    } else {
      this.camera.zoom = THREE.MathUtils.clamp(
        this.camera.zoom / factor,
        0.001,
        10000,
      );
      this.camera.updateProjectionMatrix();
    }
    this.invalidate();
  }
  private wheel = (event: WheelEvent) => {
    // Capture before OrbitControls so scroll direction and speed apply exactly once.
    if (this.navigationPaused) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.animation = null;
    const units =
      event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1;
    const change =
      event.deltaY *
      units *
      0.001 *
      this.navigation.zoomSensitivity *
      (this.navigation.reverseScroll ? -1 : 1);
    this.zoomBy(Math.exp(THREE.MathUtils.clamp(change, -2, 2)));
  };
  private pointerDown = (event: PointerEvent) => {
    if (this.navigationPaused || event.ctrlKey || event.metaKey || event.altKey)
      return;
    if (this.editorPointer?.(event)) return;
    if (
      event.pointerType === "touch" &&
      !this.editorTap &&
      this.floatingTouchEnabled()
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const rect = this.renderer.domElement.getBoundingClientRect();
      const side =
        event.clientX < rect.left + rect.width / 2 ? "left" : "right";
      if ([...this.touchSticks.values()].some((stick) => stick.side === side))
        return;
      const multiple = this.touchSticks.size > 0;
      for (const stick of this.touchSticks.values()) stick.moved = true;
      this.touchSticks.set(event.pointerId, {
        side,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        dx: 0,
        dy: 0,
        clientX: event.clientX,
        clientY: event.clientY,
        moved: multiple,
        started: performance.now(),
      });
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.publishTouchSticks();
      return;
    }
    if (event.pointerType !== "touch") event.stopImmediatePropagation();
    this.renderer.domElement.focus({ preventScroll: true });
    this.pointers.add(event.pointerId);
    if (this.pointers.size === 1) {
      this.start = {
        x: event.clientX,
        y: event.clientY,
        id: event.pointerId,
        action:
          event.pointerType === "touch"
            ? this.tool === "walk"
              ? "look"
              : "none"
            : mouseAction(this.navigation, event.button, event.shiftKey),
        canSelect: event.button === 0 && !event.shiftKey,
      };
      this.gestureMoved = false;
      this.gestureDistance = 0;
      if (event.pointerType !== "touch" || this.start.action !== "none") {
        event.preventDefault();
        this.renderer.domElement.setPointerCapture(event.pointerId);
      }
    } else this.gestureMoved = true;
    this.animation = null;
    this.invalidate();
  };
  private pointerMove = (event: PointerEvent) => {
    const stick = this.touchSticks.get(event.pointerId);
    if (stick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const dx = event.clientX - stick.clientX,
        dy = event.clientY - stick.clientY;
      const distance = Math.hypot(dx, dy);
      const radius = this.navigation.touch.size * 0.36;
      const magnitude = Math.min(
        1,
        Math.max(0, (distance / radius - 0.12) / 0.88),
      );
      stick.dx = distance ? (dx / distance) * magnitude : 0;
      stick.dy = distance ? (dy / distance) * magnitude : 0;
      if (distance > 6) stick.moved = true;
      this.setThumb(stick.side, stick.dx, stick.dy);
      this.publishTouchSticks();
      return;
    }

    if (this.start?.id !== event.pointerId) return;
    const dx = event.clientX - this.start.x,
      dy = event.clientY - this.start.y;
    this.gestureDistance += Math.hypot(dx, dy);
    if (this.gestureDistance > 5) this.gestureMoved = true;
    if (this.start.action === "pan" && this.pointers.size === 1) {
      // Camera right/up span the plane perpendicular to its viewing direction.
      const scale =
        this.camera instanceof THREE.PerspectiveCamera
          ? (2 *
              this.camera.position.distanceTo(this.controls.target) *
              Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) /
            this.camera.zoom /
            this.height
          : (this.camera.top - this.camera.bottom) /
            this.camera.zoom /
            this.height;
      const delta = new THREE.Vector3(
        -dx * scale,
        dy * scale,
        0,
      ).applyQuaternion(this.camera.quaternion);
      delta.multiplyScalar(
        this.navigation.panSensitivity * (this.navigation.reversePan ? -1 : 1),
      );
      this.camera.position.add(delta);
      this.controls.target.add(delta);
      this.start = { ...this.start, x: event.clientX, y: event.clientY };
      this.invalidate();
      return;
    }
    if (this.start.action === "zoom" && this.pointers.size === 1) {
      this.zoomBy(
        Math.exp(
          THREE.MathUtils.clamp(
            dy * 0.01 * this.navigation.zoomSensitivity,
            -2,
            2,
          ),
        ),
      );
      this.start = { ...this.start, x: event.clientX, y: event.clientY };
      return;
    }
    const sensitivity = 0.003 * this.navigation.lookSensitivity;
    const horizontal = dx * sensitivity * (this.navigation.invertX ? -1 : 1);
    const vertical = dy * sensitivity * (this.navigation.invertY ? -1 : 1);
    if (this.start.action === "orbit" && this.pointers.size === 1) {
      const offset = this.camera.position.clone().sub(this.controls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.radius = Math.max(0.01, spherical.radius);
      spherical.theta -= horizontal;
      spherical.phi -= vertical;
      spherical.makeSafe();
      this.camera.position
        .copy(this.controls.target)
        .add(offset.setFromSpherical(spherical));
      this.camera.lookAt(this.controls.target);
      this.start = { ...this.start, x: event.clientX, y: event.clientY };
      this.invalidate();
      return;
    }
    if (this.start.action === "look" && this.pointers.size === 1) {
      const rotation = new THREE.Euler().setFromQuaternion(
        this.camera.quaternion,
        "YXZ",
      );
      rotation.y -= horizontal;
      rotation.x = Math.min(
        Math.PI * 0.48,
        Math.max(-Math.PI * 0.48, rotation.x - vertical),
      );
      this.camera.quaternion.setFromEuler(rotation);
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
        this.camera.quaternion,
      );
      const distance = Math.max(
        0.01,
        this.camera.position.distanceTo(this.controls.target),
      );
      this.controls.target
        .copy(this.camera.position)
        .addScaledVector(direction, distance);
      this.start = { ...this.start, x: event.clientX, y: event.clientY };
      this.invalidate();
    }
  };
  private pointerCancel = (e: PointerEvent) => {
    const stick = this.touchSticks.get(e.pointerId);
    if (stick) {
      this.setThumb(stick.side, 0, 0);
      this.touchSticks.delete(e.pointerId);
      this.publishTouchSticks();
    }

    this.pointers.delete(e.pointerId);
    this.start = null;
    this.gestureMoved = true;
  };
  private pointerUp = (event: PointerEvent) => {
    const stick = this.touchSticks.get(event.pointerId);
    if (stick) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setThumb(stick.side, 0, 0);
      this.touchSticks.delete(event.pointerId);
      this.publishTouchSticks();
      if (
        !stick.moved &&
        performance.now() - stick.started < 350 &&
        this.tool !== "walk"
      )
        this.activateAt(event.clientX, event.clientY);
      return;
    }

    this.pointers.delete(event.pointerId);
    if (
      !this.start ||
      !this.start.canSelect ||
      this.gestureMoved ||
      this.pointers.size ||
      event.button !== 0 ||
      this.tool === "walk"
    ) {
      if (!this.pointers.size) this.start = null;
      return;
    }
    this.start = null;
    this.activateAt(event.clientX, event.clientY);
  };
  private activateAt(x: number, y: number) {
    if (this.editorTap) {
      this.editorTap(x, y);
      return;
    }
    const hit = this.pick(x, y);
    if (!hit) {
      if (this.tool === "inspect") this.select(null);
      return;
    }
    if (this.tool === "inspect") {
      this.select(hit.key);
      this.callbacks.select(this.elements.get(hit.key)!.info, tuple(hit.point));
    } else if (this.tool === "pin") {
      this.callbacks.pin(this.elements.get(hit.key)!.info, tuple(hit.point));
    } else {
      this.draft.push(this.snapVertex(hit, x, y));
      if (this.tool === "distance" && this.draft.length === 2)
        this.finishMeasurement();
      else this.drawMeasurements();
    }
    this.invalidate();
  }
  private pick(x: number, y: number) {
    const ray = this.editorRay(x, y);
    this.scene.updateMatrixWorld();
    const hits = this.picker.intersect(ray);
    for (const hit of hits) {
      if (this.clipping.some((p) => p.distanceToPoint(hit.point) < 0)) continue;
      const batch = hit.object;
      const index = hit.batchId;
      const key = this.batchKeys.get(batch)?.get(index);
      if (key && batch.getVisibleAt(index))
        return { ...hit, key, batch, index };
    }
    return null;
  }
  private snapVertex(
    hit: NonNullable<ReturnType<ModelScene["pick"]>>,
    x: number,
    y: number,
  ) {
    if (!hit.face) return hit.point;
    const geometry = hit.batch.geometry;
    const position = geometry.getAttribute("position");
    const matrix = new THREE.Matrix4();
    hit.batch.getMatrixAt(hit.index, matrix);
    const rect = this.inputRect();
    let best = hit.point,
      distance = 12;
    for (const index of [hit.face.a, hit.face.b, hit.face.c]) {
      const point = new THREE.Vector3()
        .fromBufferAttribute(position, index)
        .applyMatrix4(matrix);
      if (this.clipping.some((p) => p.distanceToPoint(point) < 0)) continue;
      const screen = point.clone().project(this.camera);
      const gap = Math.hypot(
        rect.left + ((screen.x + 1) * rect.width) / 2 - x,
        rect.top + ((1 - screen.y) * rect.height) / 2 - y,
      );
      if (gap < distance) {
        best = point;
        distance = gap;
      }
    }
    return best;
  }
  select(key: string | null) {
    const old = this.selected;
    this.selected = key;
    for (const k of [old, key]) {
      if (!k) continue;
      const entry = this.elements.get(k);
      for (const part of entry?.parts ?? [])
        part.batch.setColorAt(
          part.index,
          k === key ? new THREE.Vector4(0.12, 0.5, 1, 1) : part.color,
        );
    }
    if (!key) this.callbacks.select(null);
    this.invalidate();
  }
  hideSelection() {
    if (this.selected) this.hidden.add(this.selected);
    this.updateVisibility();
  }
  isolateSelection() {
    if (this.selected) this.isolated = new Set([this.selected]);
    this.updateVisibility();
  }
  showAll() {
    this.hidden.clear();
    this.isolated.clear();
    this.categories.clear();
    this.levels.clear();
    this.updateVisibility();
  }
  filter(categories: string[], levels: string[]) {
    this.categories = new Set(categories);
    this.levels = new Set(levels);
    this.updateVisibility();
  }
  private updateVisibility(keys: Iterable<string> = this.elements.keys()) {
    for (const key of keys) {
      const entry = this.elements.get(key);
      if (!entry) continue;
      const visible =
        !this.designDeleted.has(key) &&
        !this.hidden.has(key) &&
        (!this.isolated.size || this.isolated.has(key)) &&
        (!this.categories.size || this.categories.has(entry.info.type)) &&
        (!this.levels.size || this.levels.has(entry.info.level));
      for (const part of entry.parts)
        part.batch.setVisibleAt(part.index, visible);
    }
    this.invalidate();
  }
  visibleElements() {
    return [...this.elements.values()]
      .filter((e) => e.parts.some((p) => p.batch.getVisibleAt(p.index)))
      .map((e) => e.info);
  }
  setXray(on: boolean) {
    this.xray = on;
    for (const batch of this.batches) {
      const material = batch.material as THREE.MeshStandardMaterial;
      material.transparent = true;
      material.opacity = on ? 0.2 : 1;
      material.depthWrite = !on;
      material.needsUpdate = true;
    }
    this.invalidate();
  }
  setSection(
    section: BimViewState["section"],
    box: BimViewState["sectionBox"] = null,
  ) {
    this.section = section;
    this.sectionBox = box;
    const planes: THREE.Plane[] = [];
    if (section) {
      const normal = new THREE.Vector3(
        section.axis === "x" ? 1 : 0,
        section.axis === "y" ? 1 : 0,
        section.axis === "z" ? 1 : 0,
      ).multiplyScalar(section.flipped ? -1 : 1);
      planes.push(
        new THREE.Plane(normal, -section.value * (section.flipped ? -1 : 1)),
      );
    }
    if (box) {
      for (let axis = 0; axis < 3; axis++) {
        const normal = new THREE.Vector3().setComponent(axis, 1);
        planes.push(
          new THREE.Plane(normal, -box.min[axis]!),
          new THREE.Plane(normal.clone().negate(), box.max[axis]),
        );
      }
    }
    this.clipping = planes;
    for (const b of this.batches) {
      b.material.clippingPlanes = planes;
      b.material.needsUpdate = true;
    }
    this.invalidate();
  }
  boxSelection() {
    if (!this.selected) return null;
    const bounds = this.bounds([this.selected]).expandByScalar(0.25);
    const box = { min: tuple(bounds.min), max: tuple(bounds.max) };
    this.setSection(null, box);
    return box;
  }
  setUnits(units: "metric" | "imperial") {
    this.units = units;
    this.drawMeasurements();
  }
  finishMeasurement() {
    const minimum = this.tool === "area" ? 3 : 2;
    if (this.draft.length < minimum) {
      this.callbacks.error(`Pick at least ${minimum} points on the model.`);
      return;
    }
    if (this.tool === "area") {
      const plane = new THREE.Plane().setFromCoplanarPoints(
        this.draft[0]!,
        this.draft[1]!,
        this.draft[2]!,
      );
      if (
        !plane.normal.length() ||
        this.draft.some((p) => Math.abs(plane.distanceToPoint(p)) > 0.01)
      ) {
        this.callbacks.error(
          "Area points must lie on the same plane. Clear this measurement and pick a flat surface.",
        );
        return;
      }
    }
    const measure: BimMeasurement = {
      id: crypto.randomUUID(),
      type: this.tool === "area" ? "area" : "distance",
      points: this.draft.map(tuple),
      label: "",
    };
    this.measures.push(measure);
    this.draft = [];
    this.drawMeasurements();
    this.callbacks.measurement([...this.measures]);
  }
  clearMeasurements() {
    this.measures = [];
    this.draft = [];
    this.drawMeasurements();
    this.callbacks.measurement([]);
  }
  private clearGroup(group: THREE.Group) {
    group.traverse((obj) => {
      if (obj instanceof THREE.Line || obj instanceof THREE.Mesh) {
        const mesh = obj as THREE.Mesh<
          THREE.BufferGeometry,
          THREE.Material | THREE.Material[]
        >;
        mesh.geometry.dispose();
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        materials.forEach((m) => m.dispose());
      }
      if (obj instanceof CSS2DObject) obj.element.remove();
    });
    group.clear();
  }
  private drawMeasurements() {
    this.clearGroup(this.measureGroup);
    const all = [
      ...this.measures,
      ...(this.draft.length
        ? [
            {
              id: "draft",
              type:
                this.tool === "area"
                  ? ("area" as const)
                  : ("distance" as const),
              points: this.draft.map(tuple),
              label: "",
            },
          ]
        : []),
    ];
    for (const m of all) {
      const points = m.points.map((p) => new THREE.Vector3(...p));
      if (!points.length) continue;
      const geometry = new THREE.BufferGeometry().setFromPoints(
        m.type === "area" && points.length > 2
          ? [...points, points[0]!]
          : points,
      );
      const material = new THREE.LineBasicMaterial({
        color: 0x1677ff,
        depthTest: false,
        transparent: true,
      });
      const line = new THREE.Line(geometry, material);
      line.renderOrder = 999;
      this.measureGroup.add(line);
      for (const p of points) {
        const marker = document.createElement("div");
        marker.style.cssText =
          "width:8px;height:8px;background:#1677ff;border:2px solid white;border-radius:50%;box-shadow:0 1px 3px #0004";
        const obj = new CSS2DObject(marker);
        obj.position.copy(p);
        this.measureGroup.add(obj);
      }
      if (points.length >= 2) {
        const div = document.createElement("div");
        div.textContent = formatModelMeasure(
          m.type === "area" ? measureArea(m.points) : measureDistance(m.points),
          this.units,
          m.type === "area",
        );
        div.style.cssText =
          "background:#fff;color:#18314e;padding:4px 7px;border-radius:5px;font:600 12px system-ui;box-shadow:0 1px 5px #0003;white-space:nowrap";
        const label = new CSS2DObject(div);
        label.position.copy(
          points
            .reduce((sum, p) => sum.add(p), new THREE.Vector3())
            .divideScalar(points.length),
        );
        this.measureGroup.add(label);
      }
    }
    this.invalidate();
  }
  setIssues(issues: BimIssue[]) {
    this.clearGroup(this.issueGroup);
    for (const [index, issue] of issues.entries()) {
      if (!issue.view.modelIds.some((id) => this.models.has(id))) continue;
      const button = document.createElement("button");
      button.textContent = String(index + 1);
      button.title = issue.title;
      button.setAttribute("aria-label", `Open issue: ${issue.title}`);
      button.style.cssText = `pointer-events:auto;width:28px;height:28px;border-radius:50%;border:2px solid white;background:${["resolved", "closed"].includes(issue.status) ? "#15803d" : "#ea580c"};color:white;font:700 12px system-ui;box-shadow:0 2px 6px #0005`;
      button.onclick = (e) => {
        e.stopPropagation();
        this.callbacks.issue(issue.id);
      };
      const pin = new CSS2DObject(button);
      pin.position
        .fromArray(issue.point)
        .add(new THREE.Vector3(...issue.view.origin))
        .sub(this.origin);
      this.issueGroup.add(pin);
    }
    this.invalidate();
  }
  capture(modelIds: string[]): BimViewState {
    return {
      modelIds,
      position: tuple(this.camera.position),
      target: tuple(this.controls.target),
      origin: tuple(this.origin),
      up: tuple(this.camera.up),
      projection:
        this.camera === this.perspective ? "perspective" : "orthographic",
      orthoScale: this.orthographic.top - this.orthographic.bottom,
      hidden: [...this.hidden],
      isolated: [...this.isolated],
      categories: [...this.categories],
      levels: [...this.levels],
      section: this.section,
      sectionBox: this.sectionBox,
      measurements: this.measures,
      xray: this.xray,
    };
  }
  restore(view: BimViewState) {
    this.animation = null;
    this.setProjection(view.projection);
    this.camera.position.fromArray(view.position);
    this.camera.up.fromArray(view.up);
    this.controls.target.fromArray(view.target);
    this.orthographic.top = view.orthoScale / 2;
    this.orthographic.bottom = -view.orthoScale / 2;
    this.resizeView();
    this.hidden = new Set(view.hidden);
    this.isolated = new Set(view.isolated);
    this.categories = new Set(view.categories);
    this.levels = new Set(view.levels);
    this.measures = view.measurements;
    this.setSection(view.section, view.sectionBox);
    this.setXray(view.xray);
    this.updateVisibility();
    this.drawMeasurements();
    this.controls.update();
    this.invalidate();
  }
  screenshot() {
    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
    const source = this.renderer.domElement,
      canvas = document.createElement("canvas");
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    const host = this.host.getBoundingClientRect(),
      scale = canvas.width / host.width;
    ctx.scale(scale, scale);
    for (const group of [this.measureGroup, this.issueGroup])
      group.traverse((obj) => {
        if (
          !(obj instanceof CSS2DObject) ||
          obj.element.style.display === "none"
        )
          return;
        const r = obj.element.getBoundingClientRect(),
          style = getComputedStyle(obj.element);
        const x = r.left - host.left,
          y = r.top - host.top;
        ctx.fillStyle = style.backgroundColor;
        ctx.beginPath();
        ctx.roundRect(
          x,
          y,
          r.width,
          r.height,
          parseFloat(style.borderRadius) || 0,
        );
        ctx.fill();
        if (obj.element.textContent) {
          ctx.font = style.font;
          ctx.fillStyle = style.color;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(
            obj.element.textContent,
            x + r.width / 2,
            y + r.height / 2,
          );
        }
      });
    return canvas.toDataURL("image/png");
  }
  dispose() {
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.resize.disconnect();
    this.controls.dispose();
    for (const id of this.models.keys()) this.removeModel(id);
    this.designOriginals.clear();
    this.designDeleted.clear();
    this.picker.clear();
    this.clearGroup(this.measureGroup);
    this.clearGroup(this.issueGroup);
    this.grid.geometry.dispose();
    (this.grid.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.labels.domElement.remove();
  }
}
