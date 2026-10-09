import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { SimulationProvider, EndSimulationButton } from "./SimulationProvider";
import {
  SIMULATION_VIEW_HEADER,
  clearSimulationNavigationCache,
  simulationCacheName,
  type EmployeeSimulation,
} from "~/lib/employee-simulation";
const simulation: EmployeeSimulation = {
  id: "session-id",
  actorId: "executive",
  employeeId: "employee",
  employeeName: "Pat",
  employeeEmail: "pat@example.invalid",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};
const fetchMock = vi.fn<typeof window.fetch>();
beforeEach(() => {
  fetchMock
    .mockReset()
    .mockResolvedValue(Response.json({ view: "session-id" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function Child() {
  useEffect(() => {
    void fetch("/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    void fetch("https://clerk.example.test/asset");
  }, []);
  return (
    <>
      <p>Employee view</p>
      <EndSimulationButton />
    </>
  );
}
it("scopes child API requests and offline caches before they can initialize", async () => {
  render(
    <SimulationProvider simulation={simulation} actorId="executive">
      <Child />
    </SimulationProvider>,
  );
  await screen.findByText("Employee view");
  const apiRequest = fetchMock.mock.calls.find(
    (call) => call[0] === "/api/test",
  )!;
  expect(new Headers(apiRequest[1]?.headers).get(SIMULATION_VIEW_HEADER)).toBe(
    "session-id",
  );
  expect(new Headers(apiRequest[1]?.headers).get("content-type")).toBe(
    "application/json",
  );
  expect(
    fetchMock.mock.calls.find(
      (call) => call[0] === "https://clerk.example.test/asset",
    )?.[1],
  ).toBeUndefined();
  expect(simulationCacheName("materials")).toBe(
    "materials-simulation-session-id",
  );
  expect(screen.getByRole("button", { name: "End Simulation" })).toHaveClass(
    "bg-red-600",
  );
});
it("restores normal account scoping and omits the end button outside simulation", async () => {
  render(
    <SimulationProvider simulation={null} actorId="executive">
      <Child />
    </SimulationProvider>,
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  const apiRequest = fetchMock.mock.calls.find(
    (call) => call[0] === "/api/test",
  )!;
  expect(new Headers(apiRequest[1]?.headers).get(SIMULATION_VIEW_HEADER)).toBe(
    "account:executive",
  );
  expect(simulationCacheName("materials")).toBe("materials");
  expect(
    screen.queryByRole("button", { name: "End Simulation" }),
  ).not.toBeInTheDocument();
});

it("clears cached page shells when switching without affecting images or notification registration", async () => {
  const remove = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("caches", {
    keys: async () => [
      "foremenhq-offline-shell-v13:pages",
      "foremenhq-offline-shell-v13:static",
      "foremenhq-offline-shell-v13:images",
      "foremanhq-push-binding",
    ],
    delete: remove,
  });
  await clearSimulationNavigationCache();
  expect(remove).toHaveBeenCalledExactlyOnceWith(
    "foremenhq-offline-shell-v13:pages",
  );
});
