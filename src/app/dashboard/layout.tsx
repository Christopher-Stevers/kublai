import { HydrateClient } from "~/trpc/server";
import { Header } from "../_components/Header";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <HydrateClient>
      <div className="flex min-h-screen flex-col bg-gray-50">
        <Header />
        <main className="flex-1">{children}</main>
      </div>
    </HydrateClient>
  );
}

