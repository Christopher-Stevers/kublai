import type * as ThreeModule from "three";
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
    document.body.append(host);
    scene = new ModelScene(host, {
      select: vi.fn(),
      pin: vi.fn(),
      measurement: vi.fn(),
      error: vi.fn(),
      issue: vi.fn(),
    });
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
});
