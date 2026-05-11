import type { PetMood, TodoItem } from "../../shared/types";

export type PetVisualState = PetMood | "confused" | "dragging" | "urgent" | "rest" | "sleepy";
export type LocalPetMood = PetMood | "confused";

export function getPetVisualState({
  mood,
  dragging,
  hasOverdueOpenTodo,
  idleMs,
  chatOpen
}: {
  mood: LocalPetMood;
  dragging: boolean;
  hasOverdueOpenTodo: boolean;
  idleMs: number;
  chatOpen: boolean;
}): PetVisualState {
  if (dragging) return "dragging";
  if (hasOverdueOpenTodo) return "urgent";
  if (mood === "confused") return "confused";
  if (mood !== "idle") return mood;
  if (idleMs >= 10 * 60_000) return "sleepy";
  if (idleMs >= 5 * 60_000) return "rest";
  return "idle";
}

export function getTransientMoodDuration(mood: LocalPetMood) {
  switch (mood) {
    case "reminder":
      return 4000;
    case "happy":
      return 2500;
    case "talking":
      return 3500;
    case "confused":
      return 3500;
    default:
      return 3000;
  }
}

export function isOverdueOpenTodo(todo: TodoItem, now: number) {
  if (todo.status !== "open") return false;
  const target = todo.dueAt ?? todo.remindAt;
  if (!target) return false;
  const targetTime = new Date(target).getTime();
  return Number.isFinite(targetTime) && targetTime <= now;
}

export function mergePetImages(
  baseImages: Record<PetVisualState, string>,
  customImages?: Partial<Record<string, string>>
): Record<PetVisualState, string> {
  const images = { ...baseImages };
  if (!customImages) return images;
  for (const state of Object.keys(images) as PetVisualState[]) {
    const customImage = customImages[state];
    if (customImage) images[state] = customImage;
  }
  return images;
}
