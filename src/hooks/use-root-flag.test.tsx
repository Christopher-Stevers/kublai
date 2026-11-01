import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import { useRootFlag } from "./use-root-flag";

function Flag({ on }: { on: boolean }) {
  useRootFlag("data-test-flag", on);
  return null;
}

it("keeps the root flag while any holder wants it", () => {
  const root = document.documentElement;
  const first = render(<Flag on />);
  const second = render(<Flag on={false} />);
  expect(root).toHaveAttribute("data-test-flag");
  second.rerender(<Flag on />);
  first.unmount();
  expect(root).toHaveAttribute("data-test-flag");
  second.rerender(<Flag on={false} />);
  expect(root).not.toHaveAttribute("data-test-flag");
  second.rerender(<Flag on />);
  expect(root).toHaveAttribute("data-test-flag");
  second.unmount();
  expect(root).not.toHaveAttribute("data-test-flag");
});
