// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  installedPostgresVersion,
  observeListenLoss,
} from "./listen-lifecycle";
function connection(onclose: (...args: unknown[]) => unknown) {
  const options = { onclose };
  const internal = Object.assign(() => undefined, { options });
  return { listen: Object.assign(() => undefined, { sql: internal }), options };
}
it("pins the actually installed driver and preserves onclose this/args/return/reconnect", () => {
  expect(installedPostgresVersion()).toBe("3.4.8");
  const seen: unknown[] = [],
    context = {};
  const original = vi.fn(function (this: unknown, ...args: unknown[]) {
    seen.push(this, ...args);
    return "reconnecting";
  });
  const source = connection(original),
    lost = vi.fn();
  const stop = observeListenLoss(source, "3.4.8", lost);
  expect(stop).not.toBeNull();
  expect(source.options.onclose.call(context, 42, "x")).toBe("reconnecting");
  expect(seen).toEqual([context, 42, "x"]);
  expect(lost).toHaveBeenCalledOnce();
  stop!();
  source.options.onclose();
  expect(lost).toHaveBeenCalledOnce();
  expect(original).toHaveBeenCalledTimes(2);
});
it("never stacks wrappers and preserves original throw despite notification errors", () => {
  const error = new Error("driver");
  const original = vi.fn(() => {
    throw error;
  });
  const source = connection(original),
    a = vi.fn(() => {
      throw Error("subscriber");
    }),
    b = vi.fn();
  const stopA = observeListenLoss(source, "3.4.8", a),
    wrapped = source.options.onclose;
  const stopB = observeListenLoss(source, "3.4.8", b);
  expect(source.options.onclose).toBe(wrapped);
  expect(() => source.options.onclose()).toThrow(error);
  expect(a).toHaveBeenCalledOnce();
  expect(b).toHaveBeenCalledOnce();
  expect(original).toHaveBeenCalledOnce();
  stopA!();
  stopB!();
});
for (const version of [null, "3.4.9", "4.0.0"])
  it(`unsupported version ${version} never changes driver`, () => {
    const original = vi.fn(),
      source = connection(original);
    expect(observeListenLoss(source, version, vi.fn())).toBeNull();
    expect(source.options.onclose).toBe(original);
  });
it("fails closed on unknown shape or read-only callback", () => {
  for (const value of [null, {}, { listen: () => undefined }])
    expect(observeListenLoss(value, "3.4.8", vi.fn())).toBeNull();
  const source = connection(vi.fn());
  Object.freeze(source.options);
  expect(observeListenLoss(source, "3.4.8", vi.fn())).toBeNull();
});

it("never wraps the outer pool even if an unsupported shape points listen.sql there", () => {
  const source = connection(vi.fn());
  source.listen.sql = source as unknown as typeof source.listen.sql;
  const before = source.options.onclose;
  expect(observeListenLoss(source, "3.4.8", vi.fn())).toBeNull();
  expect(source.options.onclose).toBe(before);
});
