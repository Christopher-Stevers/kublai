// Expanded steel laid over the (shaded) checker plate, which shows through the holes.
export const EXPANDED_METAL = {
  backgroundImage:
    "url(/images/chat-expanded-metal.webp?v=4), linear-gradient(rgba(8,8,9,0.42), rgba(8,8,9,0.42)), url(/images/chat-checker-plate.webp?v=5)",
  backgroundSize: "56px 28px, auto, 384px 384px",
  backgroundColor: "#3f4143",
};
/** Riveted steel angle along the join between expanded steel and checker plate. */
export function AngleTrim({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden="true"
      className="relative z-10 h-4 shrink-0"
      style={{
        backgroundImage: "url(/images/chat-angle-trim.webp?v=3)",
        backgroundSize: "96px 16px",
        backgroundRepeat: "repeat-x",
        boxShadow:
          edge === "top"
            ? "0 3px 5px rgba(0,0,0,0.45)"
            : "0 -3px 5px rgba(0,0,0,0.35)",
      }}
    />
  );
}
export const ON_METAL = "text-white hover:bg-white/15 hover:text-white";
// On wide screens the conversation keeps a readable width; the steel stays full width.
export const CHAT_COLUMN = "mx-auto w-full max-w-3xl";
/** Dark oak planks behind the slide-out chat panel. */
export const OAK_PLANKS = {
  backgroundImage:
    "linear-gradient(90deg, rgba(0,0,0,0.25), rgba(0,0,0,0) 30%), url(/images/chat-oak-planks.webp?v=1)",
  backgroundSize: "auto, 400px 600px",
  backgroundColor: "#2e1d0f",
};
export const CHECKER_PLATE = {
  // Soft overhead light falling off toward the edges.
  backgroundImage:
    "radial-gradient(ellipse 130% 90% at 50% 0%, rgba(255,255,255,0.07), rgba(0,0,0,0) 55%, rgba(0,0,0,0.2)), url(/images/chat-checker-plate.webp?v=5)",
  backgroundSize: "auto, 384px 384px",
  backgroundColor: "#6b6d70",
};
