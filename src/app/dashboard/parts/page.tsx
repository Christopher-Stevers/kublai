import { PartsList } from "~/components/suppliers/PartsList";

export default function PartsPage() {
  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Parts</h1>
          <p className="text-muted-foreground mt-2">
            Manage preferred suppliers for each part. When selecting a part in
            quotes or orders, the preferred supplier will be automatically
            selected.
          </p>
        </div>
        <PartsList />
      </div>
    </div>
  );
}

