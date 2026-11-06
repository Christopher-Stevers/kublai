import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DrawingScrollPage } from "./DrawingScrollPage";

afterEach(cleanup);
const page = { id: "sheet", name: "M-308", imageUrl: "/api/job-rooms/files/job/floor-20.webp", width: 1200, height: 800 };
const props = { page, offset: 1, style: { top: 500, width: 600, height: 400 } };

it("keeps a paper placeholder before loading, after errors, and during thumbnail fallback", () => {
  const view = render(<DrawingScrollPage {...props} loadPreview={false} />);
  expect(view.container.querySelector("img")).toBeNull();
  expect(screen.getByText("M-308")).toBeVisible();
  const paper = view.container.firstElementChild as HTMLElement;
  expect(paper.style.height).toBe("400px");
  view.rerender(<DrawingScrollPage {...props} loadPreview />);
  expect(screen.getByText("Loading preview…")).toBeVisible();
  const image = screen.getByAltText("M-308");
  expect(image).toHaveAttribute("src", `${page.imageUrl}?thumb=1`);
  fireEvent.error(image);
  expect(image).toHaveAttribute("src", page.imageUrl);
  expect(paper).toHaveAttribute("data-preview-ready", "false");
  expect(screen.getByText("Preview unavailable")).toBeVisible();
  fireEvent.load(image);
  expect(paper).toHaveAttribute("data-preview-ready", "true");
  expect(screen.queryByText("Preview unavailable")).toBeNull();
  expect(paper.style.height).toBe("400px");
});
