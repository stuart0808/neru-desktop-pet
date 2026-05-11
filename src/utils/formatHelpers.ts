import type { TodoItem, TodoPriority } from "../../shared/types";
import { startOfDay, startOfWeek } from "./dateHelpers";

export function formatPriority(priority?: TodoPriority) {
  if (priority === "urgent") return "紧急";
  if (priority === "high") return "高";
  if (priority === "low") return "低";
  return "中";
}

export function formatRelativeTodoTime(todo: TodoItem) {
  const source = todo.dueAt ?? todo.remindAt;
  if (!source) return "";
  const date = new Date(source);
  if (!Number.isFinite(date.getTime())) return "";
  const todayStart = startOfDay(new Date()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60_000;
  const dayAfterTomorrowStart = tomorrowStart + 24 * 60 * 60_000;
  const timeText = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (date.getTime() < Date.now()) return `逾期 ${date.toLocaleString()}`;
  if (date.getTime() < tomorrowStart) return `今天 ${timeText}`;
  if (date.getTime() < dayAfterTomorrowStart) return `明天 ${timeText}`;
  return date.toLocaleString(undefined, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function formatSummaryRangeTitle(range: "today" | "week" | "month", locale?: string) {
  const now = new Date();
  if (range === "week") {
    const start = startOfWeek(now);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    return `${start.toLocaleDateString(locale)} - ${end.toLocaleDateString(locale)}`;
  }
  if (range === "month") return now.toLocaleDateString(locale, { year: "numeric", month: "long" });
  return now.toLocaleDateString(locale);
}
