import { redirect } from "next/navigation";
import { getRequestIdentity } from "~/server/utils/get-request-identity";
import { headers } from "next/headers";
import { Header } from "~/app/_components/Header";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, user } = await getRequestIdentity(await headers());

  // Redirect if not authenticated
  if (!userId) {
    redirect("/sign-in");
  }

  // Redirect if not admin
  if (user?.role !== "admin" && !user?.organizationId) {
    redirect("/onboarding");
  }
  if (user?.role !== "admin") {
    redirect("/dashboard");
  }

  return (
    <div className="bg-muted/50 min-h-screen">
      <Header />
      <main>{children}</main>
    </div>
  );
}
