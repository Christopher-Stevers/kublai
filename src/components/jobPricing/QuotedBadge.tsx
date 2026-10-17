export function QuotedBadge({
  status,
  onPhoto = false,
}: {
  status?: string;
  onPhoto?: boolean;
}) {
  if (status !== "estimated" && status !== "confirmed") return null;

  return (
    <span
      className={`${onPhoto ? "absolute bottom-2 left-2" : "inline-block"} rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] leading-tight font-semibold tracking-wide text-white shadow-sm backdrop-blur-sm`}
    >
      Quoted
    </span>
  );
}
