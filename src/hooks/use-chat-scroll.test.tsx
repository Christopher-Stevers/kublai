import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  ChatViewProvider,
  useChatViewMemory,
} from "~/components/chat/ChatViewProvider";
import { useChatScroll } from "./use-chat-scroll";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps the same message in view when an image changes height, then lets the user move", () => {
  let resize = () => {
    /* Replaced when the observer is created. */
  };
  let messageTop = 500;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {
        /* The test triggers resize explicitly. */
      }
      disconnect() {
        /* No browser observer is active in this test. */
      }
    },
  );
  function Timeline() {
    const ref = useRef<HTMLDivElement>(null);
    const remember = useChatScroll("scroll:test", ref, true);
    return (
      <div
        data-testid="timeline"
        onScroll={remember}
        ref={(node) => {
          ref.current = node;
          if (!node) return;
          Object.defineProperties(node, {
            scrollHeight: { value: 2000 },
            clientHeight: { value: 300 },
          });
          node.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
          const message = node.querySelector<HTMLElement>("article")!;
          message.getBoundingClientRect = () =>
            ({
              top: messageTop - node.scrollTop,
              bottom: messageTop - node.scrollTop + 50,
            }) as DOMRect;
        }}
      >
        <div>
          <article data-chat-message-id="middle">Message</article>
        </div>
      </div>
    );
  }
  function SavedView() {
    const memory = useChatViewMemory();
    memory?.set("scroll:test", {
      top: 120,
      bottom: false,
      anchor: "middle",
      offset: 10,
    });
    return <Timeline />;
  }
  render(
    <ChatViewProvider>
      <SavedView />
    </ChatViewProvider>,
  );
  const timeline = screen.getByTestId("timeline");
  expect(timeline.scrollTop).toBe(490);
  messageTop = 650;
  resize();
  expect(timeline.scrollTop).toBe(640);
  fireEvent.wheel(timeline);
  timeline.scrollTop = 200;
  fireEvent.scroll(timeline);
  messageTop = 750;
  resize();
  expect(timeline.scrollTop).toBe(200);
});
