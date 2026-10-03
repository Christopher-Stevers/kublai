import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function PendingApprovalPage() {
  const { userId, user: requestUser } = await getRequestIdentity(
    await headers(),
  );
  if (!userId) {
    redirect("/sign-in");
  }

  const user = requestUser;
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
    <main className="bg-muted/50 flex min-h-screen items-center justify-center px-6 py-12">
      <section className="border-border bg-card w-full max-w-md rounded-lg border p-6 text-center shadow-sm">
        <h1 className="text-foreground text-2xl font-bold">Access Pending</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Your account has joined the organization and is waiting for an Executive
          Account to approve access.
        </p>
      </section>
    </main>
  );
}
