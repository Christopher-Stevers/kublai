import { Suspense } from "react";
import { ConversationsView } from "~/components/chat/ConversationsView";
export default function ChatPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-4">
          Loading chat…
        </p>
      }
    >
      <ConversationsView />
    </Suspense>
  );
}
