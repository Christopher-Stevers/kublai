import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ practice: false }));
vi.mock("~/components/tutorial/tutorial-sandbox-context", () => ({
  useTutorialSandbox: () => (state.practice ? {} : null),
}));
vi.mock("~/components/chat/ConversationsView", () => ({
  ConversationsView: ({ initialJobId }: { initialJobId: string }) => (
    <div data-testid="workspace" data-job={initialJobId} />
  ),
}));
vi.mock("./JobChatThread", () => ({
  JobChatThread: ({ jobId }: { jobId: string }) => (
    <div data-testid="practice" data-job={jobId} />
  ),
}));
import { JobChatView } from "./JobChatView";
afterEach(() => {
  cleanup();
  state.practice = false;
});
it("opens a job from either job entry point in the shared chat window", () => {
  render(<JobChatView jobId="job-one" />);
  expect(screen.getByTestId("workspace")).toHaveAttribute(
    "data-job",
    "job-one",
  );
});
it("keeps tutorial chat in its practice sandbox", () => {
  state.practice = true;
  render(<JobChatView jobId="practice-job" />);
  expect(screen.getByTestId("practice")).toHaveAttribute(
    "data-job",
    "practice-job",
  );
  expect(screen.queryByTestId("workspace")).not.toBeInTheDocument();
});
