import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TutorialExperience } from "./TutorialExperience";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
}

function reachQuantity(listName?: string) {
  click(/Riverside Community Centre/);
  click(/^Material Lists/);
  click("New material list");
  if (listName)
    fireEvent.change(screen.getByRole("textbox", { name: "List name" }), {
      target: { value: listName },
    });
  click("Create list");
  click("Add Part");
  click("Plumbing");
  click("PVC");
  click("XFR");
  click('2"');
  click("Fittings");
  click('2" XFR 90');
}

describe("guided tutorial practice", () => {
  it("starts with only the demo job and an accessible guided target", () => {
    render(<TutorialExperience onFinish={vi.fn()} finishing={false} />);
    expect(screen.getByText("Select your job")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Jobs" })).toHaveFocus();
    expect(
      screen.getByRole("button", { name: /Riverside Community Centre/ }),
    ).toHaveAccessibleDescription("Select your job");
    expect(screen.getByRole("button", { name: "End tutorial" })).toBeEnabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("completes materials, room notes and request, and a local-only chat without network calls", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const onFinish = vi.fn();
    render(<TutorialExperience onFinish={onFinish} finishing={false} />);
    reachQuantity();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Quantity" }), {
      target: { value: "12" },
    });
    click("Add to list");
    expect(screen.getByText("Qty 12")).toBeVisible();
    click("Back to job");
    click(/^Rooms/);
    click("Ground floor · 3 rooms");
    expect(screen.getByRole("img", { name: /Example floor/ })).toBeVisible();
    click("Mechanical room");
    expect(screen.getByRole("button", { name: "Save note" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Room notes" }), {
      target: { value: "Keep the panel clear." },
    });
    click("Save note");
    expect(screen.getByText("Keep the panel clear.")).toBeVisible();
    click("Request material");
    expect(
      screen.getByRole("heading", { name: /^Mechanical room — / }),
    ).toBeVisible();
    expect(screen.getByText("Room: Mechanical room")).toBeVisible();
    click("Back to job");
    click(/^Chat/);
    expect(
      screen.getByRole("button", { name: "Send practice message" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
      target: { value: "Materials ready." },
    });
    click("Send practice message");
    expect(screen.getByText("Materials ready.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "You're ready" })).toHaveFocus();
    expect(onFinish).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    click("Finish tutorial");
    expect(onFinish).toHaveBeenCalledExactlyOnceWith("completed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("allows ending early without creating or submitting anything", () => {
    const onFinish = vi.fn();
    render(<TutorialExperience onFinish={onFinish} finishing={false} />);
    click(/Riverside Community Centre/);
    click("End tutorial");
    expect(onFinish).toHaveBeenCalledExactlyOnceWith("skipped");
  });

  it("keeps unrelated paths and choices disabled until their turn", () => {
    render(<TutorialExperience onFinish={vi.fn()} finishing={false} />);
    click(/Riverside Community Centre/);
    expect(screen.getByRole("button", { name: "Rooms" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Chat" })).toBeDisabled();
    click("Chat");
    expect(
      screen.getByRole("button", { name: /^Material Lists/ }),
    ).toBeEnabled();
    click(/^Material Lists/);
    click("New material list");
    fireEvent.change(screen.getByRole("textbox", { name: "List name" }), {
      target: { value: "   " },
    });
    expect(screen.getByRole("button", { name: "Create list" })).toBeDisabled();
  });

  it("requires a valid quantity and uses the user's chosen list title", () => {
    render(<TutorialExperience onFinish={vi.fn()} finishing={false} />);
    reachQuantity("Morning rough-in");
    const quantity = screen.getByRole("spinbutton", { name: "Quantity" });
    for (const value of ["", "0", "-1", "1.5", "1000"]) {
      fireEvent.change(quantity, { target: { value } });
      expect(
        screen.getByRole("button", { name: "Add to list" }),
      ).toBeDisabled();
    }
    fireEvent.change(quantity, { target: { value: "3" } });
    expect(screen.getByRole("button", { name: "Add to list" })).toBeEnabled();
    click("Add to list");
    expect(
      screen.getByRole("heading", { name: "Morning rough-in" }),
    ).toBeVisible();
    expect(screen.getByText("Qty 3")).toBeVisible();
  });

  it("locks all actions while finishing and exposes retry errors without losing the demo", () => {
    const onFinish = vi.fn();
    const view = render(
      <TutorialExperience onFinish={onFinish} finishing={true} />,
    );
    expect(screen.getByRole("button", { name: "End tutorial" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Riverside Community Centre/ }),
    ).toBeDisabled();
    click(/Riverside Community Centre/);
    expect(screen.getByRole("heading", { name: "Jobs" })).toBeVisible();
    view.rerender(
      <TutorialExperience
        onFinish={onFinish}
        finishing={false}
        error="Could not save your tutorial status."
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save your tutorial status.",
    );
    click("End tutorial");
    expect(onFinish).toHaveBeenCalledExactlyOnceWith("skipped");
  });
});
