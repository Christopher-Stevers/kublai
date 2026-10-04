import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TutorialExperience } from "./TutorialExperience";

const calls = vi.hoisted(() => ({ dashboard: vi.fn(), provider: vi.fn() }));
vi.mock("~/app/dashboard/DashboardClient", () => ({
  DashboardClient: (props: unknown) => {
    calls.dashboard(props);
    return <div>Normal job workflow</div>;
  },
}));
vi.mock("~/app/_components/Header", () => ({
  Header: () => <header>Normal header</header>,
}));
vi.mock("./TutorialSandboxProvider", () => ({
  TutorialSandboxProvider: ({
    children,
    userId,
  }: {
    children: ReactNode;
    userId: string;
  }) => {
    calls.provider(userId);
    return children;
  },
}));
vi.mock("./TutorialOverlay", () => ({
  TutorialOverlay: ({
    onFinish,
  }: {
    onFinish: (outcome: "completed" | "skipped") => void;
  }) => <button onClick={() => onFinish("skipped")}>End tutorial</button>,
}));
afterEach(cleanup);
it("mounts the actual dashboard/header with no real initial jobs and keeps the overlay attached", () => {
  const finish = vi.fn();
  render(<TutorialExperience userId="practice-user" onFinish={finish} />);
  expect(screen.getByText("Normal job workflow")).toBeInTheDocument();
  expect(screen.getByText("Normal header")).toBeInTheDocument();
  expect(calls.dashboard).toHaveBeenCalledWith({ initialJobs: [] });
  expect(calls.provider).toHaveBeenCalledWith("practice-user");
  // The welcome screen comes first; the guided overlay starts with the tour.
  expect(screen.getByRole("dialog", { name: "Welcome to ForemanHQ" })).toBeInTheDocument();
  expect(screen.queryByText("End tutorial")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Start the tour" }));
  expect(screen.queryByRole("dialog", { name: "Welcome to ForemanHQ" })).toBeNull();
  fireEvent.click(screen.getByText("End tutorial"));
  expect(finish).toHaveBeenCalledWith("skipped");
});
it("can skip the tour from the welcome screen", () => {
  const finish = vi.fn();
  render(<TutorialExperience userId="practice-user" onFinish={finish} />);
  fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
  expect(finish).toHaveBeenCalledWith("skipped");
});
