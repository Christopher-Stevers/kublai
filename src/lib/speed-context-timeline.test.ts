import { expect, it } from "vitest";
import { SpeedContextTimeline } from "./speed-context-timeline";

it("attributes a final vital to its interaction screen and link, not the screen at reporting time", () => {
  const timeline = new SpeedContextTimeline({
    screen: "materials",
    link: "slow",
  });
  timeline.record(200, { screen: "job", link: "slow" });
  timeline.record(300, { screen: "job", link: "fast" });
  expect(timeline.forVital([{ startTime: 150 }, { startTime: 160 }])).toEqual({
    screen: "materials",
    link: "slow",
  });
  expect(timeline.forVital([{ startTime: 250 }])).toEqual({
    screen: "job",
    link: "slow",
  });
  expect(timeline.forVital([{ startTime: 350 }])).toEqual({
    screen: "job",
    link: "fast",
  });
});

it("does not guess a screen for missing, invalid or evicted interaction timing", () => {
  const timeline = new SpeedContextTimeline({
    screen: "materials",
    link: "slow",
  });
  for (let at = 1; at < 300; at++)
    timeline.record(at, { screen: at % 2 ? "job" : "jobs", link: "fast" });
  for (const entries of [
    undefined,
    [],
    [{ startTime: NaN }],
    [{ startTime: -1 }],
    [{ startTime: 0 }],
  ]) {
    expect(timeline.forVital(entries)).toEqual({
      screen: "other",
      link: "unknown",
    });
  }
  expect(timeline.at(299)).toEqual({ screen: "job", link: "fast" });
});

it("ignores out-of-order changes and retains history across repeated identical context observations", () => {
  const timeline = new SpeedContextTimeline({
    screen: "materials",
    link: "slow",
  });
  for (let at = 1; at < 400; at++)
    timeline.record(at, { screen: "materials", link: "slow" });
  expect(timeline.at(0)).toEqual({ screen: "materials", link: "slow" });
  timeline.record(500, { screen: "job", link: "fast" });
  timeline.record(450, { screen: "chat", link: "slow" });
  expect(timeline.at(600)).toEqual({ screen: "job", link: "fast" });
});
