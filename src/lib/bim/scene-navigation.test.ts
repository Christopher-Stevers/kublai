import type * as ThreeModule from "three";
import { Vector3 as ThreeVector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelScene, type ModelTool } from "./scene";
import { DEFAULT_NAVIGATION, navigationPreset } from "./navigation-settings";

vi.mock("three", async (original) => {
  const actual = await original<typeof ThreeModule>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      setPixelRatio() {
        /* No GPU or layout observer in this test. */
      }
      setSize() {
        /* No GPU or layout observer in this test. */
      }
      render() {
        /* No GPU or layout observer in this test. */
      }
      dispose() {
        /* No GPU or layout observer in this test. */
      }
      forceContextLoss() {
        /* No GPU or layout observer in this test. */
      }
    },
  };
});

describe("WASD with model tools", () => {
  let scene: ModelScene | undefined;
  afterEach(() => {
    scene?.dispose();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });
  function setup(tool: ModelTool) {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          /* No GPU or layout observer in this test. */
        }
        disconnect() {
          /* No GPU or layout observer in this test. */
        }
      },
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const host = document.createElement("div");
    Object.defineProperties(host, {
      clientWidth: { value: 800 },
      clientHeight: { value: 600 },
    });
    document.body.append(host);
    scene = new ModelScene(host, {
      select: vi.fn(),
      pin: vi.fn(),
      measurement: vi.fn(),
      error: vi.fn(),
      issue: vi.fn(),
    });
    const canvas = scene.renderer.domElement;
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    scene.setTool(tool);
    return scene;
  }
  it.each<ModelTool>(["inspect", "distance", "area", "pin", "walk"])(
    "moves without changing the %s tool",
    (tool) => {
      const engine = setup(tool);
      const canvas = engine.renderer.domElement;
      const initial = engine.camera.position.clone();
      const target = engine.controls.target.clone();
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: "w", cancelable: true }),
      );
      // Exercise the real scene frame without requiring a GPU in the test runner.
      const frame = engine as unknown as {
        render: (time: number) => void;
        tool: ModelTool;
      };
      frame.render(16);
      const delta = engine.camera.position.clone().sub(initial);
      expect(delta.length()).toBeGreaterThan(0);
      expect(
        engine.controls.target.clone().sub(target).distanceTo(delta),
      ).toBeLessThan(1e-8);
      expect(frame.tool).toBe(tool);
      canvas.dispatchEvent(new KeyboardEvent("keyup", { key: "w" }));
      const stopped = engine.camera.position.clone();
      frame.render(32);
      expect(engine.camera.position.distanceTo(stopped)).toBeLessThan(1e-8);
    },
  );
  it("ignores browser shortcuts and stops on lost focus", () => {
    const engine = setup("distance");
    const canvas = engine.renderer.domElement;
    const state = engine as unknown as { keys: Set<string> };
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", ctrlKey: true }),
    );
    expect(state.keys.size).toBe(0);
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
    expect(state.keys.has("forward")).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(state.keys.size).toBe(0);
  });
  function pointer(
    engine: ModelScene,
    type: string,
    x: number,
    y: number,
    button = 0,
    pointerType = "mouse",
    extra = {},
  ) {
    const event = new MouseEvent(type, {
      clientX: x,
      clientY: y,
      button,
      buttons: type === "pointerup" ? 0 : button === 1 ? 4 : 1,
      bubbles: true,
      cancelable: true,
      ...extra,
    });
    Object.defineProperties(event, {
      pointerId: { value: 1 },
      pointerType: { value: pointerType },
    });
    engine.renderer.domElement.dispatchEvent(event);
  }
  it.each<ModelTool>(["inspect", "distance", "area", "pin", "walk"])(
    "pivots at the camera with %s selected",
    (tool) => {
      const engine = setup(tool);
      const position = engine.camera.position.clone();
      const rotation = engine.camera.quaternion.clone();
      const distance = position.distanceTo(engine.controls.target);
      pointer(engine, "pointerdown", 100, 100);
      pointer(engine, "pointermove", 180, 140);
      pointer(engine, "pointerup", 180, 140);
      (engine as unknown as { render(time: number): void }).render(16);
      expect(engine.camera.position.distanceTo(position)).toBeLessThan(1e-8);
      expect(engine.camera.quaternion.angleTo(rotation)).toBeGreaterThan(0.1);
      expect(
        engine.camera.position.distanceTo(engine.controls.target),
      ).toBeCloseTo(distance);
      expect((engine as unknown as { tool: ModelTool }).tool).toBe(tool);
      expect((engine as unknown as { draft: unknown[] }).draft).toHaveLength(0);
    },
  );
  it.each<ModelTool>(["inspect", "distance", "area", "pin", "walk"])(
    "middle-pans perpendicular to the view in %s",
    (tool) => {
      const engine = setup(tool);
      engine.camera.lookAt(engine.controls.target);
      engine.camera.updateMatrixWorld();
      const position = engine.camera.position.clone();
      const target = engine.controls.target.clone();
      const rotation = engine.camera.quaternion.clone();
      const forward = engine.camera.getWorldDirection(new ThreeVector3());
      pointer(engine, "pointerdown", 100, 100, 1, "mouse", { shiftKey: true });
      pointer(engine, "pointermove", 160, 130, 1, "mouse", { shiftKey: true });
      pointer(engine, "pointerup", 160, 130, 1);
      const delta = engine.camera.position.clone().sub(position);
      expect(delta.length()).toBeGreaterThan(0);
      expect(delta.dot(forward)).toBeCloseTo(0);
      expect(
        engine.controls.target.clone().sub(target).distanceTo(delta),
      ).toBeLessThan(1e-8);
      expect(engine.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
      expect((engine as unknown as { draft: unknown[] }).draft).toHaveLength(0);
    },
  );
  it("does not look on hover and stops looking after capture is lost", () => {
    const engine = setup("inspect");
    const rotation = engine.camera.quaternion.clone();
    pointer(engine, "pointermove", 120, 120);
    expect(engine.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
    pointer(engine, "pointerdown", 100, 100);
    pointer(engine, "lostpointercapture", 100, 100);
    pointer(engine, "pointermove", 200, 200);
    expect(engine.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
  });
  it("does not pick or measure after a series of small look movements", () => {
    const engine = setup("distance");
    const pick = vi.spyOn(
      engine as unknown as { pick(x: number, y: number): unknown },
      "pick",
    );
    pointer(engine, "pointerdown", 100, 100);
    for (let x = 101; x <= 110; x++) pointer(engine, "pointermove", x, 100);
    pointer(engine, "pointerup", 110, 100);
    expect(pick).not.toHaveBeenCalled();
  });
  it("keeps click-to-inspect available", () => {
    const engine = setup("inspect");
    const pick = vi.spyOn(
      engine as unknown as { pick(x: number, y: number): unknown },
      "pick",
    );
    pointer(engine, "pointerdown", 100, 100);
    pointer(engine, "pointerup", 100, 100);
    expect(pick).toHaveBeenCalledWith(100, 100);
  });
  it("middle-pans an orthographic camera at its current zoom", () => {
    const engine = setup("inspect");
    engine.setProjection("orthographic");
    engine.camera.zoom = 2;
    engine.camera.updateProjectionMatrix();
    const position = engine.camera.position.clone();
    const direction = engine.camera.getWorldDirection(new ThreeVector3());
    const camera = engine.orthographic;
    pointer(engine, "pointerdown", 100, 100, 1);
    pointer(engine, "pointermove", 200, 100, 1);
    pointer(engine, "pointerup", 200, 100, 1);
    const delta = engine.camera.position.clone().sub(position);
    expect(delta.length()).toBeCloseTo(
      (100 * (camera.top - camera.bottom)) / 2 / 600,
    );
    expect(delta.dot(direction)).toBeCloseTo(0);
  });
  it("rebinds movement, keeps an alternate held, and pauses while controls are open", () => {
    const engine = setup("area");
    const settings = navigationPreset("left-handed");
    engine.setNavigationSettings(settings);
    const canvas = engine.renderer.domElement;
    const state = engine as unknown as { keys: Set<string> };
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", code: "KeyW" }),
    );
    expect(state.keys.size).toBe(0);
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "i", code: "KeyI" }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowUp", code: "ArrowUp" }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent("keyup", { key: "i", code: "KeyI" }),
    );
    expect(state.keys.has("forward")).toBe(true);
    engine.setNavigationPaused(true);
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "i", code: "KeyI" }),
    );
    expect(state.keys.size).toBe(0);
    expect(engine.controls.enabled).toBe(false);
    engine.setNavigationPaused(false);
    expect(state.keys.size).toBe(0);
    expect(engine.controls.enabled).toBe(true);
  });
  it("orbits around the target with the CAD preset and does not place points", () => {
    const engine = setup("distance");
    engine.setNavigationSettings(navigationPreset("cad"));
    const position = engine.camera.position.clone();
    const target = engine.controls.target.clone();
    const distance = position.distanceTo(target);
    const pick = vi.spyOn(
      engine as unknown as { pick(x: number, y: number): unknown },
      "pick",
    );
    pointer(engine, "pointerdown", 100, 100);
    pointer(engine, "pointermove", 180, 140);
    pointer(engine, "pointerup", 180, 140);
    expect(engine.camera.position.distanceTo(position)).toBeGreaterThan(1);
    expect(engine.controls.target.distanceTo(target)).toBeLessThan(1e-8);
    expect(engine.camera.position.distanceTo(target)).toBeCloseTo(distance);
    expect(pick).not.toHaveBeenCalled();
  });
  it("uses configured shift-drag and right-drag actions", () => {
    const engine = setup("pin");
    engine.setNavigationSettings({
      ...DEFAULT_NAVIGATION,
      mouse: { ...DEFAULT_NAVIGATION.mouse, shiftLeft: "pan", right: "look" },
    });
    const rotation = engine.camera.quaternion.clone();
    const position = engine.camera.position.clone();
    pointer(engine, "pointerdown", 100, 100, 0, "mouse", { shiftKey: true });
    pointer(engine, "pointermove", 180, 140, 0, "mouse", { shiftKey: true });
    pointer(engine, "pointerup", 180, 140, 0);
    expect(engine.camera.position.distanceTo(position)).toBeGreaterThan(0);
    expect(engine.camera.quaternion.angleTo(rotation)).toBeLessThan(1e-7);
    const panned = engine.camera.position.clone();
    pointer(engine, "pointerdown", 100, 100, 2);
    pointer(engine, "pointermove", 180, 140, 2);
    pointer(engine, "pointerup", 180, 140, 2);
    expect(engine.camera.position.distanceTo(panned)).toBeLessThan(1e-8);
    expect(engine.camera.quaternion.angleTo(rotation)).toBeGreaterThan(0.1);
  });
  it("supports reversed scroll in both projections and leaves measurement active", () => {
    const engine = setup("distance");
    engine.setNavigationSettings({
      ...DEFAULT_NAVIGATION,
      reverseScroll: true,
    });
    const distance = engine.camera.position.distanceTo(engine.controls.target);
    engine.renderer.domElement.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
    );
    expect(
      engine.camera.position.distanceTo(engine.controls.target),
    ).toBeLessThan(distance);
    engine.setProjection("orthographic");
    const zoom = engine.camera.zoom;
    engine.renderer.domElement.dispatchEvent(
      new WheelEvent("wheel", { deltaY: 100, cancelable: true }),
    );
    expect(engine.camera.zoom).toBeGreaterThan(zoom);
    expect((engine as unknown as { tool: ModelTool }).tool).toBe("distance");
  });
  it("invokes fit and camera shortcuts once per press, without intercepting browser shortcuts", () => {
    const engine = setup("inspect");
    const fit = vi.spyOn(engine, "fit");
    const preset = vi.spyOn(engine, "preset");
    const canvas = engine.renderer.domElement;
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true }),
    );
    expect(fit).not.toHaveBeenCalled();
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", code: "KeyF" }),
    );
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "f", code: "KeyF", repeat: true }),
    );
    expect(fit).toHaveBeenCalledOnce();
    canvas.dispatchEvent(
      new KeyboardEvent("keydown", { key: "7", code: "Digit7" }),
    );
    expect(preset).toHaveBeenCalledWith("top");
  });
  it("steers and flies with independent thumbs, then stops on release and interruption", () => {
    const engine = setup("distance");
    const frame = engine as unknown as {
      render: (time: number) => void;
      draft: unknown[];
    };
    const before = engine.camera.position.clone();
    const orientation = engine.camera.quaternion.clone();
    engine.setThumb("left", 0.6, -0.3);
    engine.setThumb("right", 0, -0.8);
    frame.render(16);
    expect(engine.camera.position.distanceTo(before)).toBeGreaterThan(0);
    expect(engine.camera.quaternion.angleTo(orientation)).toBeGreaterThan(0);
    expect(frame.draft).toHaveLength(0);
    engine.setThumb("left", 0, 0);
    engine.setThumb("right", 0, 0);
    const stopped = engine.camera.position.clone();
    frame.render(32);
    expect(engine.camera.position.distanceTo(stopped)).toBeLessThan(1e-8);
    engine.setThumb("right", 0, -1);
    window.dispatchEvent(new Event("blur"));
    frame.render(48);
    expect(engine.camera.position.distanceTo(stopped)).toBeLessThan(1e-8);
    engine.setThumb("right", 0, -1);
    engine.setNavigationPaused(true);
    frame.render(64);
    expect(engine.camera.position.distanceTo(stopped)).toBeLessThan(1e-8);
  });
  it("preserves proportional thumb speed and supports orbit without moving the target", () => {
    const engine = setup("inspect");
    const frame = engine as unknown as { applyThumbs: (dt: number) => void };
    let initial = engine.camera.position.clone();
    engine.setThumb("right", 0, -0.5);
    frame.applyThumbs(0.02);
    const half = engine.camera.position.distanceTo(initial);
    initial = engine.camera.position.clone();
    engine.setThumb("right", 0, -1);
    frame.applyThumbs(0.02);
    expect(engine.camera.position.distanceTo(initial)).toBeCloseTo(half * 2);
    engine.setNavigationSettings({
      ...structuredClone(DEFAULT_NAVIGATION),
      touch: { ...DEFAULT_NAVIGATION.touch, left: "orbit", right: "none" },
    });
    const target = engine.controls.target.clone();
    initial = engine.camera.position.clone();
    engine.setThumb("left", 0.5, 0.5);
    frame.applyThumbs(0.02);
    expect(engine.controls.target.distanceTo(target)).toBeLessThan(1e-8);
    expect(engine.camera.position.distanceTo(initial)).toBeGreaterThan(0);
  });
  it("anchors floating joysticks at each touch and releases them independently", () => {
    const engine = setup("inspect");
    engine.setNavigationSettings({
      ...structuredClone(DEFAULT_NAVIGATION),
      touch: { ...DEFAULT_NAVIGATION.touch, display: "always" },
    });
    const canvas = engine.renderer.domElement;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const state = engine as unknown as {
      thumbs: Record<string, { x: number; y: number }>;
      pointerDown: (e: PointerEvent) => void;
      pointerMove: (e: PointerEvent) => void;
      pointerUp: (e: PointerEvent) => void;
      pointerCancel: (e: PointerEvent) => void;
      activateAt: (x: number, y: number) => void;
    };
    const event = (id: number, x: number, y: number) =>
      ({
        pointerId: id,
        pointerType: "touch",
        clientX: x,
        clientY: y,
        preventDefault: vi.fn(),
        stopImmediatePropagation: vi.fn(),
      }) as unknown as PointerEvent;
    state.pointerDown(event(1, 120, 200));
    state.pointerDown(event(2, 600, 300));
    expect(state.thumbs.left).toEqual({ x: 0, y: 0 });
    state.pointerMove(event(1, 150, 200));
    state.pointerMove(event(2, 600, 270));
    expect(state.thumbs.left!.x).toBeGreaterThan(0);
    expect(state.thumbs.right!.y).toBeLessThan(0);
    state.pointerUp(event(1, 150, 200));
    expect(state.thumbs.left).toEqual({ x: 0, y: 0 });
    expect(state.thumbs.right!.y).toBeLessThan(0);
    state.pointerCancel(event(2, 600, 270));
    expect(state.thumbs.right).toEqual({ x: 0, y: 0 });
    const tap = vi
      .spyOn(state, "activateAt")
      .mockImplementation(() => undefined);
    state.pointerDown(event(3, 200, 150));
    state.pointerUp(event(3, 200, 150));
    expect(tap).toHaveBeenCalledWith(200, 150);
  });
});
