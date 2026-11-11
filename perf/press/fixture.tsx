import { createRoot } from "react-dom/client";
import { Button } from "../../src/components/ui/button";
import { PressableCard } from "../../src/components/ui/pressable-card";
const result = { opens: 0, fixed: 0, writes: 0, prepared: 0, cancelled: 0 };
const feedback = new URLSearchParams(window.location.search).get("feedback") ?? "state";
if (feedback !== "state" && feedback !== "attribute") throw Error("Unknown press feedback mode");
Object.assign(window, { pressResult: result });
createRoot(document.getElementById("root")!).render(
  <>
    <Button id="fixed" press="fixed" onClick={() => result.fixed++}>
      Fixed tool
    </Button>
    <Button id="write" onClick={() => result.writes++}>
      Send order
    </Button>
    <div
      id="rows"
      style={{
        height: 600,
        overflowY: "auto",
        touchAction: "pan-y",
        border: "1px solid black",
        marginTop: 20,
      }}
    >
      {Array.from({ length: 40 }, (_, i) => (
        <PressableCard
          key={i}
          feedback={feedback}
          role="button"
          tabIndex={0}
          style={{ height: 100, borderBottom: "1px solid #999" }}
          prepare={(signal) => {
            result.prepared++;
            signal.addEventListener("abort", () => result.cancelled++, {
              once: true,
            });
          }}
          onClick={() => result.opens++}
        >
          Job {i}
        </PressableCard>
      ))}
    </div>
  </>,
);
