import { ClipboardList, DoorOpen, MessageSquare, type LucideIcon } from "lucide-react";
import type { TutorialPhase } from "./tutorial-guide";

/** The tour's three chapters, shown on the welcome screen and as progress. */
export const TUTORIAL_CHAPTERS: Array<{
  phase: Exclude<TutorialPhase, "done">;
  label: string;
  icon: LucideIcon;
  /** What the chapter teaches, for the welcome screen. */
  intro: string;
  /** What the person did, for the finish checklist. */
  done: string;
}> = [
  {
    phase: "materials",
    label: "Material lists",
    icon: ClipboardList,
    intro: "Start a list and add a part from the catalogue.",
    done: "Built a material list",
  },
  {
    phase: "rooms",
    label: "Rooms",
    icon: DoorOpen,
    intro: "Find a room on the drawing and leave it a note.",
    done: "Explored a room on the drawing",
  },
  {
    phase: "chat",
    label: "Chat",
    icon: MessageSquare,
    intro: "Send your crew a message about the job.",
    done: "Sent a message to the crew",
  },
];
