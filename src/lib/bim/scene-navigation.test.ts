import type * as ThreeModule from "three";
import { Vector3 as ThreeVector3 } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelScene, type ModelTool } from "./scene";

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
    expect(state.keys.has("w")).toBe(true);
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
});
