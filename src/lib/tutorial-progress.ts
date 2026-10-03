export type TutorialOutcome = "completed" | "skipped";
export type TutorialProgress = {
  status: "active" | TutorialOutcome;
  pending: boolean;
  token: string;
};
export function tutorialStorageKey(userId: string) {
  return `foremanhq.tutorial.v1:${userId}`;
}
export function readTutorialProgress(userId: string): TutorialProgress | null {
  try {
    const raw = window.localStorage.getItem(tutorialStorageKey(userId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TutorialProgress>;
    if (
      (value.status !== "active" &&
        value.status !== "completed" &&
        value.status !== "skipped") ||
      typeof value.pending !== "boolean" ||
      typeof value.token !== "string"
    )
      return null;
    return value as TutorialProgress;
  } catch {
    return null;
  }
}
export function writeTutorialProgress(
  userId: string,
  progress: TutorialProgress,
) {
  try {
    window.localStorage.setItem(
      tutorialStorageKey(userId),
      JSON.stringify(progress),
    );
    return true;
  } catch {
    return false;
  }
}
