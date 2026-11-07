"use client";
import { ConversationsView } from "~/components/chat/ConversationsView";
import { useTutorialSandbox } from "~/components/tutorial/tutorial-sandbox-context";
import { JobChatThread } from "./JobChatThread";

export function JobChatView({ jobId }: { jobId: string }) {
  const sandbox = useTutorialSandbox();
  return sandbox ? (
    <JobChatThread jobId={jobId} />
  ) : (
    <ConversationsView initialJobId={jobId} />
  );
}
