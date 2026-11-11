import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PartImage from "./PartImage";
const resource = vi.hoisted(() => ({
  cached: undefined as
    | Record<
        string,
        { width: number; height: number; box: number[]; background: string }
      >
    | undefined,
  load: vi.fn(),
}));
vi.mock("~/lib/part-image-layout-resource", () => ({
  cachedPartImageLayouts: () => resource.cached,
  isCatalogueImageSource: (s: string) =>
    /^\/api\/catalogue\/images\/[^/?#]+$/.test(s),
  loadPartImageLayouts: resource.load,
}));
vi.mock("next/image", () => ({
  default: ({ fill: _fill, ...props }: { fill?: boolean }) => (
    <img {...props} alt={(props as { alt?: string }).alt} />
  ),
}));
const a = "/api/catalogue/images/a.webp",
  b = "/api/catalogue/images/b.webp";
const layouts = {
  [a]: {
    width: 600,
    height: 400,
    box: [30, 40, 500, 300],
    background: "#fafafa",
  },
};
let resolve: () => void, reject: () => void;
beforeEach(() => {
  resource.cached = undefined;
  resource.load.mockReset();
  resource.load.mockImplementation(
    () =>
      new Promise<void>((yes, no) => {
        resolve = () => {
          resource.cached = layouts;
          yes();
        };
        reject = () => no(new Error("offline"));
      }),
  );
});
afterEach(cleanup);
it("reserves the same fill box without showing unaudited pixels, then renders exact audited framing", async () => {
  const { container } = render(
    <PartImage
      src={a}
      alt="Elbow"
      fill
      className="part-photo"
      style={{ opacity: 0.8 }}
    />,
  );
  const pending = screen.getByRole("img", { name: "Elbow" });
  expect(pending).toHaveAttribute("data-part-image-layout", "pending");
  expect(pending).toHaveAttribute("width", "100%");
  expect(pending).toHaveClass("part-photo");
  expect(pending).toHaveStyle({ position: "absolute", opacity: "0.8" });
  expect(container.querySelector("image,img")).toBeNull();
  await act(async () => resolve());
  expect(screen.getByRole("img", { name: "Elbow" })).toHaveAttribute(
    "width",
    "100%",
  );
  expect(container.querySelector("rect")).toHaveAttribute("fill", "#fafafa");
  expect(container.querySelector("svg svg")).toHaveAttribute(
    "viewBox",
    "30 40 500 300",
  );
  expect(container.querySelector("image")).toHaveAttribute("href", a);
});
it("renders cached metadata synchronously without requesting again", () => {
  resource.cached = layouts;
  const { container } = render(
    <PartImage src={a} alt="" width={48} height={48} />,
  );
  expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  expect(container.firstChild).toHaveAttribute("width", "48");
  expect(container.querySelector("title")).toBeNull();
  expect(resource.load).not.toHaveBeenCalled();
});
it("bypasses unrelated and external sources", () => {
  const { rerender } = render(
    <PartImage
      src="https://example.invalid/a.webp"
      alt="External"
      width={48}
      height={48}
    />,
  );
  expect(screen.getByRole("img")).toHaveAttribute(
    "src",
    "https://example.invalid/a.webp",
  );
  rerender(
    <PartImage src="/new-photo.webp" alt="New" width={48} height={48} />,
  );
  expect(resource.load).not.toHaveBeenCalled();
});
it("uses ordinary image for an unknown catalogue URL after metadata loads", async () => {
  render(<PartImage src={b} alt="Unknown" width={48} height={48} />);
  await act(async () => resolve());
  expect(screen.getByRole("img")).toHaveAttribute("src", b);
});
it("ignores a replaced source's completion", async () => {
  const { rerender } = render(
    <PartImage src={a} alt="A" width={48} height={48} />,
  );
  const old = resolve;
  rerender(<PartImage src="/other.webp" alt="Other" width={48} height={48} />);
  await act(async () => old());
  expect(screen.getByRole("img")).toHaveAttribute("src", "/other.webp");
});
it("falls back offline and never visibly recrops that mounted source; a revisit may retry", async () => {
  const { rerender, unmount } = render(
    <PartImage src={a} alt="A" width={48} height={48} />,
  );
  await act(async () => reject());
  expect(screen.getByRole("img")).toHaveAttribute("src", a);
  resource.cached = layouts;
  rerender(<PartImage src={a} alt="A2" width={48} height={48} />);
  expect(screen.getByRole("img")).toHaveAttribute("src", a);
  unmount();
  render(<PartImage src={a} alt="A" width={48} height={48} />);
  expect(screen.getByRole("img").tagName).toBe("svg");
});

it("retries on a later mount after an uncached offline failure", async () => {
  const first = render(<PartImage src={a} alt="A" width={48} height={32} />);
  expect(screen.getByRole("img")).toHaveAttribute("height", "32");
  await act(async () => reject());
  first.unmount();
  render(<PartImage src={a} alt="A" width={48} height={32} />);
  expect(resource.load).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("img")).toHaveAttribute(
    "data-part-image-layout",
    "pending",
  );
  await act(async () => resolve());
  expect(screen.getByRole("img")).toHaveAttribute(
    "data-part-image-layout",
    "audited",
  );
});
