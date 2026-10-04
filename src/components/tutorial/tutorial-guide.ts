export type TutorialPhase = "materials" | "rooms" | "chat" | "done";
export type TutorialGuide = {
  target: string;
  title: string;
  text: string;
  allow?: string[];
  next?: "chat" | "finish";
};
type FindTarget = (name: string) => HTMLElement | null;

/** Guidance follows the screens the app actually rendered, never simulated steps. */
export function getTutorialGuide(
  phase: TutorialPhase,
  find: FindTarget,
): TutorialGuide {
  const back = {
    target: "back",
    title: "Back to your job",
    text: "Use the back arrow to return to the job's cards.",
  };
  if (phase === "done")
    return {
      target: "chat-own-message",
      title: "You're ready",
      text: "You created a list, added material, explored Rooms, and sent a practice message. Finish to open your real jobs.",
      next: "finish",
    };
  if (phase === "materials") {
    const wizard = find("add-part-dialog");
    if (wizard) {
      const stage = wizard.dataset.tutorialStage ?? "catalog";
      const pending = Number(wizard.dataset.tutorialPendingCount ?? 0);
      if (stage === "review")
        return {
          target: "wizard-confirm",
          title: "Add the material to your list",
          text: "Check the quantity and supplier here, then tap Add to put these parts on your list.",
          allow: ["wizard-review-quantity"],
        };
      if (pending > 0)
        return {
          target: "wizard-review-button",
          title: "Review your selected parts",
          text: "Your part is selected. Open the review tray to check its quantity and supplier.",
        };
      const instructions: Record<string, [string, string]> = {
        catalog: ["Select a catalog", "Choose Plumbing from the part picker."],
        material: ["Select your material", "Open PVC, then choose XFR."],
        size: ["Select the size", "Choose the 2-inch size."],
        category: [
          "Select a category",
          "Choose Fittings to find the example part.",
        ],
        part: ["Select a part", "Tap the fitting to add it to your selection."],
      };
      const [title, text] = instructions[stage] ?? instructions.catalog!;
      return { target: `wizard-${stage}`, title, text };
    }
    if (find("add-part"))
      return {
        target: "add-part",
        title: "Add material",
        text: "Your new dated list is open. Tap Add Part to open the catalog picker.",
      };
    if (find("create-list"))
      return {
        target: "create-list",
        title: "Create a material list",
        text: "Tap New Material List. It opens immediately with today's date, just like a regular list.",
      };
    if (find("material-lists"))
      return {
        target: "material-lists",
        title: "Open Material Lists",
        text: "Lists keep this job's material requests together.",
      };
    return {
      target: "job-card",
      title: "Select your job",
      text: "This is a practice job. Only this job is available until you finish or end the tutorial.",
    };
  }
  if (phase === "rooms") {
    if (find("room-details"))
      return {
        target: "room-notes",
        title: "Notes stay with the room",
        text: "Try writing and saving a note for this room. When you're ready, continue to Chat.",
        allow: ["room-notes-save"],
        next: "chat",
      };
    if (find("room-list-item"))
      return {
        target: "room-list-item",
        title: "Open a room",
        text: "Select a room to see its details and notes.",
      };
    if (find("drawing-viewer"))
      return {
        target: "room-list-toggle",
        title: "Explore the drawing",
        text: "This is the regular drawing screen. Open its Rooms list to select a room.",
      };
    if (find("floor-card"))
      return {
        target: "floor-card",
        title: "Open a floor",
        text: "Select the example floor to view its drawing and rooms.",
      };
    if (find("rooms"))
      return {
        target: "rooms",
        title: "Open Rooms",
        text: "Next, explore the job's floors and rooms.",
      };
    return back;
  }
  if (find("chat-view")) {
    const composer = find("chat-composer") as HTMLTextAreaElement | null;
    return {
      target: composer?.value.trim() ? "chat-send" : "chat-composer",
      title: "Send a practice message",
      text: "Type a short message and tap Send. You're using the normal job chat; this practice message stays in the demo.",
      allow: ["chat-composer", "chat-send"],
    };
  }
  if (find("chat"))
    return {
      target: "chat",
      title: "Open Chat",
      text: "Job chat keeps the team's conversation with the job.",
    };
  return back;
}

export type GuideRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};
export function placeTutorialCard(
  target: GuideRect | null,
  bounds: GuideRect,
  height: number,
) {
  const margin = 12;
  const width = Math.min(330, bounds.width - margin * 2);
  const maxTop = Math.max(
    bounds.top + margin,
    bounds.top + bounds.height - height - margin,
  );
  const below = target ? target.top + target.height + 18 : bounds.top + margin;
  const above = target ? target.top - height - 18 : bounds.top + margin;
  const top =
    below + height <= bounds.top + bounds.height - margin
      ? below
      : above >= bounds.top + margin
        ? above
        : target && target.top > bounds.top + bounds.height / 2
          ? bounds.top + margin
          : maxTop;
  const left = Math.max(
    bounds.left + margin,
    Math.min(
      (target
        ? target.left + target.width / 2
        : bounds.left + bounds.width / 2) -
        width / 2,
      bounds.left + bounds.width - width - margin,
    ),
  );
  return {
    left,
    top: Math.max(bounds.top + margin, Math.min(top, maxTop)),
    width,
  };
}
