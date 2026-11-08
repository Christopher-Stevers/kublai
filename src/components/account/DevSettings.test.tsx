import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DevFeaturesProvider, useDevFeatures } from "~/components/app/DevFeaturesProvider";
import { DevSettings } from "./DevSettings";

function Status() {
  return <output>{useDevFeatures() ? "enabled" : "disabled"}</output>;
}
function settings(available = true) {
  return render(<DevFeaturesProvider enabled={available}><DevSettings /><Status /></DevFeaturesProvider>);
}
afterEach(() => { cleanup(); localStorage.clear(); });
it("updates consumers immediately and remembers the device setting", () => {
  const view = settings();
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("disabled")).toBeTruthy();
  expect(localStorage.getItem("foremanhq.dev")).toBe("0");
  view.unmount();
  settings();
  expect(screen.getByRole<HTMLInputElement>("switch").checked).toBe(false);
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("enabled")).toBeTruthy();
  expect(localStorage.getItem("foremanhq.dev")).toBe("1");
});
it("respects the legacy experimental preference until Dev is changed", () => {
  localStorage.setItem("foremanhq.experimental", "0");
  settings();
  expect(screen.getByText("disabled")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch"));
  expect(screen.getByText("enabled")).toBeTruthy();
  expect(localStorage.getItem("foremanhq.dev")).toBe("1");
});
it("cannot override a server-disabled deployment", () => {
  localStorage.setItem("foremanhq.dev", "1");
  settings(false);
  const toggle = screen.getByRole<HTMLInputElement>("switch");
  expect(toggle.disabled).toBe(true);
  expect(toggle.checked).toBe(false);
  expect(screen.getByText("disabled")).toBeTruthy();
  expect(screen.getByText("Dev features are unavailable in this deployment.")).toBeTruthy();
});
