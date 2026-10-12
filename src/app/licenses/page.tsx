import Link from "next/link";

export default function LicensesPage() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 px-5 py-10">
      <h1 className="text-2xl font-semibold">Open-source notices</h1>
      <p className="text-muted-foreground">
        License and source information for these ForemanHQ components:
      </p>
      <ul className="list-disc space-y-3 pl-5">
        <li>
          <a className="underline" href="/licenses/replicache.txt">
            Replicache sync library and its dependencies
          </a>
        </li>
        <li>
          <a className="underline" href="/licenses/chat-virtualization.txt">
            TanStack chat virtualization
          </a>
        </li>
        <li>
          <a className="underline" href="/licenses/manifold.txt">
            Manifold geometry kernel
          </a>
        </li>
        <li>
          <a className="underline" href="/licenses/dxf-parser.txt">
            DXF parser
          </a>
        </li>
      </ul>
      <Link
        className="inline-block underline"
        href="/dashboard/account/settings"
      >
        Back to settings
      </Link>
    </main>
  );
}
