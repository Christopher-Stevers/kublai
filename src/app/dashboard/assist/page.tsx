import { redirect } from "next/navigation";

// Keep old bookmarks working after removing the assistance workspace.
export default function AssistancePage() {
  redirect("/dashboard");
}
