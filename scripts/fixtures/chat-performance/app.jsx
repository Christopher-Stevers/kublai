import React, { useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChatViewProvider } from "../../../src/components/chat/ChatViewProvider";
import { useChatScroll } from "../../../src/hooks/use-chat-scroll";
import { VirtualChatMessages } from "../../../src/components/chat/VirtualChatMessages";
const message = (n) => ({ id: String(n), height: 50 + (Math.abs(n) % 5) * 32 });
function Harness() {
  const [open, setOpen] = useState(true);
  window.hideChat = () => setOpen(false);
  window.showChat = () => setOpen(true);
  const [items, setItems] = useState(() =>
    Array.from(
      {
        length:
          Number(new URLSearchParams(location.search).get("count")) || 600,
      },
      (_, n) => message(n),
    ),
  );
  return (
    <ChatViewProvider>
      {open && <App items={items} setItems={setItems} />}
    </ChatViewProvider>
  );
}
function App({ items, setItems }) {
  const scroll = useRef(null);
  const rememberScroll = useChatScroll("scroll:fixture", scroll, true);

  window.prepend = () => {
    setItems((old) => [
      ...Array.from({ length: 50 }, (_, n) =>
        message(Number(old[0].id) - 50 + n),
      ),
      ...old,
    ]);
  };
  window.append = () =>
    setItems((old) => [...old, message(Number(old.at(-1).id) + 1)]);
  window.grow = (id) =>
    setItems((old) =>
      old.map((m) => (m.id === id ? { ...m, height: m.height + 200 } : m)),
    );
  return (
    <div style={{ maxWidth: 700, margin: "auto" }}>
      <div
        ref={scroll}
        onScroll={rememberScroll}
        id="timeline"
        style={{
          height: 500,
          overflowY: "auto",
          overflowAnchor: "none",
          border: "1px solid",
          padding: 12,
        }}
      >
        <div style={{ height: 40 }}>Earlier messages</div>
        <VirtualChatMessages
          items={items}
          scrollRef={scroll}
          memoryKey="fixture"
          gap={12}
        >
          {(item) => (
            <article
              data-chat-message-id={item.id}
              style={{
                minHeight: item.height,
                background: "#dcebf6",
                borderRadius: 12,
                padding: 12,
              }}
            >
              <strong>Message {item.id}</strong>
              <p>
                {"Variable height message and photo content. ".repeat(
                  (Math.abs(Number(item.id)) % 3) + 1,
                )}
              </p>
            </article>
          )}
        </VirtualChatMessages>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Harness />);
