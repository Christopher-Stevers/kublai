import { render, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it } from "vitest";
import { useReplyFocus } from "./use-reply-focus";

function Composer({ ready }: { ready: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useReplyFocus(ref, ready);
  return <textarea ref={ref} aria-label="Message" />;
}
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("focuses the message box once ready and removes the reply flag", () => {
  window.history.replaceState(
    null,
    "",
    "/dashboard/chat?conversation=c&reply=1",
  );
  const view = render(<Composer ready={false} />);
  expect(document.activeElement).not.toBe(view.getByLabelText("Message"));
  view.rerender(<Composer ready />);
  expect(document.activeElement).toBe(view.getByLabelText("Message"));
  expect(window.location.search).toBe("?conversation=c");
});
it("leaves the page alone without the flag", () => {
  window.history.replaceState(null, "", "/dashboard/jobs/j/chat");
  const view = render(<Composer ready />);
  expect(document.activeElement).not.toBe(view.getByLabelText("Message"));
});
