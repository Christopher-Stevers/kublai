import assert from "node:assert/strict";
import test from "node:test";
import { uploadProcessingError } from "./upload-processing-error";

test("native PDF memory failures become actionable messages without crash traces", () => {
  for (const message of [
    "DeprecationWarning\nFATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory\nNative stack trace: /private/path",
    "PDF renderer stopped (SIGKILL)",
    "PDF renderer stopped (SIGABRT)",
  ]) {
    const result = uploadProcessingError(message);
    assert.match(result, /memory limit/);
    assert.match(result, /original PDF is saved/);
    assert.doesNotMatch(result, /stack|private|DeprecationWarning|FATAL/);
  }
});

test("expected validation stays useful and unexpected diagnostics remain private", () => {
  const pages = "PDF has more than 100 pages. Split it into smaller PDFs; no sheets were added.";
  assert.equal(uploadProcessingError(pages), pages);
  assert.equal(uploadProcessingError(`DeprecationWarning\n${pages}`), pages);
  assert.equal(uploadProcessingError("File is not a PDF"), "File is not a PDF");
  assert.match(uploadProcessingError("PasswordException: No password given"), /unlocked copy/);
  assert.doesNotMatch(uploadProcessingError("Database insert failed: customer data and SQL"), /customer|SQL|Database/);
});
