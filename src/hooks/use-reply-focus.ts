import { useEffect, type RefObject } from "react";

/**
 * A push notification's Reply button opens the chat with `?reply=1`.
 * Once the message box can take input, focus it and drop the flag.
 */
export function useReplyFocus(
  composer: RefObject<HTMLTextAreaElement | null>,
  ready: boolean,
) {
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("reply") !== "1") return;
    url.searchParams.delete("reply");
    window.history.replaceState(window.history.state, "", url.href);
    composer.current?.focus();
  }, [composer, ready]);
}
