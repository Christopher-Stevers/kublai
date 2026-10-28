import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { LandscapeSubBar } from "./LandscapeSubBar";
import { PriorityActionBar } from "~/components/ui/priority-action-bar";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-app-landscape");
});

const Screen = ({ dialog = false }: { dialog?: boolean }) => (
  <div data-landscape-scope data-testid="screen">
    <LandscapeSubBar className="top-bar">
      <h1>Kitchen list</h1>
    </LandscapeSubBar>
    {dialog && (
      <div data-landscape-scope>
        <PriorityActionBar data-testid="dialog-bar">
          <button>Review</button>
        </PriorityActionBar>
      </div>
    )}
    <PriorityActionBar data-testid="screen-bar">
      <button>Add Part</button>
    </PriorityActionBar>
  </div>
);

it("stays at the top in portrait", () => {
  render(<Screen />);
  expect(screen.getByRole("heading").parentElement).toHaveClass("top-bar");
});

it("joins its own screen's bottom bar in landscape, above the buttons", async () => {
  render(<Screen dialog />);
  await act(async () => {
    document.documentElement.toggleAttribute("data-app-landscape", true);
  });
  const heading = screen.getByRole("heading");
  expect(screen.getByTestId("screen-bar")).toContainElement(heading);
  expect(screen.getByTestId("dialog-bar")).not.toContainElement(heading);
  expect(
    heading.compareDocumentPosition(screen.getByRole("button", { name: "Add Part" })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();

  await act(async () => {
    document.documentElement.removeAttribute("data-app-landscape");
  });
  expect(screen.getByRole("heading").parentElement).toHaveClass("top-bar");
});
