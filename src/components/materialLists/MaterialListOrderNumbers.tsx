/** Shared by the dashboard workspace and the dedicated job material-list page. */
export function MaterialListOrderNumbers({ numbers }: { numbers?: readonly string[] }) {
  if (!numbers?.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Linked orders">
      {numbers.map((number) => (
        <span
          key={number}
          className="inline-flex rounded-md border px-2.5 py-1 text-sm font-semibold"
          style={{ backgroundColor: "#dbeafe", color: "#172554", borderColor: "#93c5fd" }}
        >
          {number}
        </span>
      ))}
    </div>
  );
}
