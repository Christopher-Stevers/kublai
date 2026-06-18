import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";

import { ensureUser } from "~/server/utils/ensure-user";

export default async function PendingApprovalPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const user = await ensureUser(userId);
  if (!user?.organizationId) {
    redirect("/onboarding");
  }

  if (
    !user.organizationAccessStatus ||
    user.organizationAccessStatus === "approved"
  ) {
    redirect("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-6 py-12">
      <section className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-gray-900">Access Pending</h1>
        <p className="mt-3 text-sm text-gray-600">
          Your account has joined the organization and is waiting for a Managing
          Account to approve access.
        </p>
      </section>
    </main>
  );
}
