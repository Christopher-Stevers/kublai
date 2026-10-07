import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPdfDocument } from "./pdf-client";
import { clearDrawingTextIndexes, readDrawingText } from "./drawing-text";
vi.mock("./pdf-client", () => ({ loadPdfDocument: vi.fn() }));
beforeEach(clearDrawingTextIndexes);
afterEach(() => vi.clearAllMocks());
function documentFixture(
  getAnnotations: () => Promise<unknown[]> = async () => [],
) {
  return {
    getPage: async () => ({
      getViewport: () => ({
        width: 100,
        height: 100,
        convertToViewportPoint: (x: number, y: number) => [x, 100 - y],
      }),
      getTextContent: async () => ({
        items: [
          {
            str: "Private note",
            transform: [1, 0, 0, 1, 10, 20],
            width: 20,
            height: 8,
          },
        ],
      }),
      getAnnotations,
    }),
    numPages: 1,
  } as unknown as Awaited<ReturnType<typeof loadPdfDocument>>;
}
describe("drawing text memory isolation", () => {
  it("discards cached text when changing accounts", async () => {
    vi.mocked(loadPdfDocument).mockResolvedValue(documentFixture());
    const source = { url: "/private.pdf", page: 1 };
    await readDrawingText(source);
    await readDrawingText(source);
    expect(loadPdfDocument).toHaveBeenCalledOnce();
    clearDrawingTextIndexes();
    await readDrawingText(source);
    expect(loadPdfDocument).toHaveBeenCalledTimes(2);
  });
  it("refuses to publish a late private text result after invalidation", async () => {
    let release!: (value: unknown[]) => void;
    vi.mocked(loadPdfDocument).mockResolvedValue(
      documentFixture(
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      ),
    );
    const pending = readDrawingText({ url: "/private.pdf", page: 1 });
    const failure = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    clearDrawingTextIndexes();
    release([]);
    await failure;
  });
});
