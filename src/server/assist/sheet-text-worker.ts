// Separate process: a complex drawing cannot block the web server event loop.
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
async function main() {
  const [filename, pageText] = process.argv.slice(2);
  if (!filename) throw new Error("Missing drawing");
  const task = getDocument({
    data: new Uint8Array(await readFile(filename)),
    useSystemFonts: true,
  });
  try {
    const document = await task.promise;
    const pageNumber = Number(pageText);
    if (
      !Number.isSafeInteger(pageNumber) ||
      pageNumber < 1 ||
      pageNumber > document.numPages
    )
      throw new Error("Invalid page");
    const page = await document.getPage(pageNumber);
    const text = await page.getTextContent();
    const items = text.items.flatMap((item) =>
      "str" in item ? [item.str] : [],
    );
    process.stdout.write(
      JSON.stringify({
        text: items.join("\n").slice(0, 24_000),
        truncated: items.join("\n").length > 24_000,
      }),
    );
  } finally {
    await task.destroy();
  }
}
main().catch(() => {
  process.stderr.write("Unable to extract drawing text");
  process.exitCode = 1;
});
