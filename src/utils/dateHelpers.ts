import type { TodoItem } from "../../shared/types";

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function startOfWeek(date: Date) {
  const base = startOfDay(date);
  const mondayOffset = (base.getDay() + 6) % 7;
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() - mondayOffset);
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function getCalendarMonthDays(month: Date) {
  const first = startOfMonth(month);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

export function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function getTodoCalendarDateKey(todo: TodoItem) {
  const source = todo.scheduledStartAt ?? todo.dueAt ?? todo.remindAt ?? todo.createdAt;
  const date = new Date(source);
  return Number.isFinite(date.getTime()) ? formatDateKey(date) : undefined;
}

export function getTodoCalendarTime(todo: TodoItem) {
  const source = todo.remindAt ?? todo.dueAt;
  if (!source) return undefined;
  const date = new Date(source);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.getHours() * 60 + date.getMinutes();
}

export function formatTodoTimelineTime(todo: TodoItem) {
  const source = todo.scheduledStartAt ?? todo.remindAt ?? todo.dueAt;
  if (!source) return "全天";
  const date = new Date(source);
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "全天";
}

export function getCalendarDisplayDate(todo: TodoItem) {
  const source = todo.scheduledStartAt ?? todo.dueAt ?? todo.remindAt ?? todo.createdAt;
  const date = new Date(source);
  return Number.isFinite(date.getTime()) ? date : new Date(todo.createdAt);
}

export function formatScheduledTime(todo: TodoItem) {
  if (!todo.scheduledStartAt) return "";
  const start = new Date(todo.scheduledStartAt);
  const end = todo.scheduledEndAt ? new Date(todo.scheduledEndAt) : null;
  if (!Number.isFinite(start.getTime())) return "";
  const startText = start.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (!end || !Number.isFinite(end.getTime())) return startText;
  return `${startText}-${end.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export function formatCalendarRange(view: "day" | "week" | "month", anchorDate: Date, visibleDays: Date[], locale?: string) {
  if (view === "month") return anchorDate.toLocaleDateString(locale, { year: "numeric", month: "long" });
  if (view === "day") return anchorDate.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const first = visibleDays[0] ?? anchorDate;
  const last = visibleDays[visibleDays.length - 1] ?? anchorDate;
  return `${first.toLocaleDateString(locale, { month: "long", day: "numeric" })} - ${last.toLocaleDateString(locale, { month: "long", day: "numeric" })}`;
}

export function formatPlanTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function isTimeInRange(value: string | undefined, start: number, end: number) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return Number.isFinite(time) && time >= start && time < end;
}

export function toDatetimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

export function nextMondayIso() {
  const date = new Date();
  const day = date.getDay();
  const offset = ((8 - day) % 7) || 7;
  date.setDate(date.getDate() + offset);
  date.setHours(9, 0, 0, 0);
  return date.toISOString();
}
