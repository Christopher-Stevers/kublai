import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { userCan } from "~/server/auth/permissions";
import { Suspense } from "react";
import { ConversationsView } from "~/components/chat/ConversationsView";
export default async function ChatPage() {
  const { user } = await getRequestIdentity(await headers(), { allowDev: true });
  if (!user) redirect("/sign-in");
  if (!userCan(user, "tab.chat"))
    redirect(userCan(user, "tab.dashboard") ? "/jobs" : "/jobs/account");
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
