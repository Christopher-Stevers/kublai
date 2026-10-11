"use client";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useChatViewMemory } from "~/components/chat/ChatViewProvider";
type Position = {
  top: number;
  bottom: boolean;
  anchor?: string;
  offset?: number;
};
function position(element: HTMLElement): Position {
  const top = element.getBoundingClientRect().top;
  const first = [
    ...element.querySelectorAll<HTMLElement>("[data-chat-message-id]"),
  ].find((node) => node.getBoundingClientRect().bottom > top);
  return {
    top: element.scrollTop,
    bottom:
      element.scrollHeight - element.scrollTop - element.clientHeight < 80,
    anchor: first?.dataset.chatMessageId,
    offset: first ? first.getBoundingClientRect().top - top : undefined,
  };
}
/** Restore the message in view, even if images above it finish loading later. */
export function useChatScroll(
  key: string,
  ref: RefObject<HTMLElement | null>,
  ready: boolean,
  onPosition?: (bottom: boolean) => void,
) {
  const memory = useChatViewMemory();
  const [saved] = useState(() => memory?.get<Position>(key));
  const restored = useRef(false),
    callback = useRef(onPosition);
  useLayoutEffect(() => {
    callback.current = onPosition;
  }, [onPosition]);
  const remember = useCallback(() => {
    if (restored.current && ref.current)
      memory?.set(key, position(ref.current));
  }, [memory, key, ref]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !ready || restored.current) return;
    restored.current = true;
    callback.current?.(saved?.bottom ?? true);
    let following = true;
    const restore = () => {
      if (!following) return;
      if (saved?.bottom) element.scrollTop = element.scrollHeight;
      else if (saved) {
        const anchor = [
          ...element.querySelectorAll<HTMLElement>("[data-chat-message-id]"),
        ].find((node) => node.dataset.chatMessageId === saved.anchor);
        if (anchor && saved.offset !== undefined)
          element.scrollTop +=
            anchor.getBoundingClientRect().top -
            element.getBoundingClientRect().top -
            saved.offset;
        else element.scrollTop = saved.top;
      }
    };
    const stop = () => {
      following = false;
    };
    restore();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(restore);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    element.addEventListener("wheel", stop, { passive: true });
    document.addEventListener("pointerdown", stop, { passive: true });
    document.addEventListener("keydown", stop, { passive: true });
    return () => {
      memory?.set(key, position(element));
      observer?.disconnect();
      element.removeEventListener("wheel", stop);
      document.removeEventListener("pointerdown", stop);
      document.removeEventListener("keydown", stop);
    };
  }, [key, memory, ready, ref, saved]);
  return remember;
}
