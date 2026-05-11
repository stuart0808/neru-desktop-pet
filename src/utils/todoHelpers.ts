import type { TodoItem, TodoPriority } from "../../shared/types";
import { startOfDay, startOfWeek, isTimeInRange } from "./dateHelpers";

export function getTodoTargetTime(todo: TodoItem) {
  const target = todo.remindAt ?? todo.dueAt;
  if (!target) return undefined;
  const time = new Date(target).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function compareTodosForWork(left: TodoItem, right: TodoItem) {
  const leftPriority = priorityRank(left.priority);
  const rightPriority = priorityRank(right.priority);
  if (leftPriority !== rightPriority) return rightPriority - leftPriority;
  const leftTime = getTodoTargetTime(left) ?? Number.POSITIVE_INFINITY;
  const rightTime = getTodoTargetTime(right) ?? Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
}

export function priorityRank(priority?: TodoPriority) {
  if (priority === "urgent") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

export function groupTodosForDisplay(todos: TodoItem[]) {
  const groups = [
    { title: "逾期", items: [] as TodoItem[] },
    { title: "今天", items: [] as TodoItem[] },
    { title: "接下来", items: [] as TodoItem[] },
    { title: "无日期", items: [] as TodoItem[] }
  ];
  const todayStart = startOfDay(new Date()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60_000;
  for (const todo of todos) {
    const time = getTodoTargetTime(todo);
    if (typeof time !== "number") groups[3].items.push(todo);
    else if (time < Date.now()) groups[0].items.push(todo);
    else if (time < tomorrowStart) groups[1].items.push(todo);
    else groups[2].items.push(todo);
  }
  return groups.filter((group) => group.items.length);
}

export function getSummaryStats(todos: TodoItem[]) {
  const now = new Date();
  const todayStart = startOfDay(now).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60_000;
  const sevenDaysLater = todayStart + 8 * 24 * 60 * 60_000;
  const openTodos = todos.filter((todo) => todo.status !== "done");
  const todayCreated = todos.filter((todo) => isTimeInRange(todo.createdAt, todayStart, tomorrowStart));
  const todayDone = todos.filter((todo) => todo.status === "done" && isTimeInRange(todo.createdAt, todayStart, tomorrowStart));
  const todayOpen = openTodos.filter((todo) => isTimeInRange(todo.createdAt, todayStart, tomorrowStart));
  const overdueTodos = openTodos.filter((todo) => {
    const time = getTodoTargetTime(todo);
    return typeof time === "number" && time <= now.getTime();
  });
  const todayReminders = openTodos.filter((todo) => {
    const time = getTodoTargetTime(todo);
    return typeof time === "number" && time > now.getTime() && time < tomorrowStart;
  });
  const upcomingTodos = openTodos
    .filter((todo) => {
      const time = getTodoTargetTime(todo);
      return typeof time === "number" && time >= tomorrowStart && time < sevenDaysLater;
    })
    .sort((a, b) => (getTodoTargetTime(a) ?? 0) - (getTodoTargetTime(b) ?? 0));

  return { openTodos, todayCreated, todayDone, todayOpen, overdueTodos, todayReminders, upcomingTodos };
}

export function getScheduleStartTime(todo: TodoItem) {
  if (!todo.scheduledStartAt) return undefined;
  const time = new Date(todo.scheduledStartAt).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export function scheduledIntersects(todo: TodoItem, start: number, end: number) {
  const scheduledStart = getScheduleStartTime(todo);
  const scheduledEnd = todo.scheduledEndAt ? new Date(todo.scheduledEndAt).getTime() : scheduledStart;
  if (typeof scheduledStart !== "number" || !Number.isFinite(scheduledEnd ?? NaN)) return false;
  return scheduledStart < end && (scheduledEnd ?? scheduledStart) >= start;
}

export function scheduledInRange(todo: TodoItem, start: number, end: number) {
  const scheduledStart = getScheduleStartTime(todo);
  return typeof scheduledStart === "number" && scheduledStart >= start && scheduledStart < end;
}

export function isDueInRange(todo: TodoItem, start: number, end: number) {
  if (!todo.dueAt) return false;
  const time = new Date(todo.dueAt).getTime();
  return Number.isFinite(time) && time >= start && time < end;
}

export function buildSummaryRisks(todos: TodoItem[], now: number, weekStart: number, weekEnd: number) {
  const risks: Array<{ todo: TodoItem; type: string; label: string; detail?: string }> = [];
  for (const todo of todos) {
    const due = todo.dueAt ? new Date(todo.dueAt).getTime() : undefined;
    const remind = todo.remindAt ? new Date(todo.remindAt).getTime() : undefined;
    const scheduledThisWeek = scheduledInRange(todo, weekStart, weekEnd);
    if (typeof due === "number" && due < now) risks.push({ todo, type: "overdue", label: "逾期未完成" });
    else if (typeof due === "number" && due < now + 24 * 60 * 60_000 && !todo.scheduledStartAt) risks.push({ todo, type: "due24", label: "24h 内到期且未计划" });
    else if (typeof remind === "number" && remind <= now) risks.push({ todo, type: "reminder", label: "提醒已到" });
    else if ((todo.priority === "urgent" || todo.priority === "high") && !scheduledThisWeek) risks.push({ todo, type: "priority", label: "高优先级但本周未计划" });
  }
  return risks.slice(0, 12);
}

export function getSummaryDashboardData(todos: TodoItem[], filters: { searchText: string; priorityFilter: TodoPriority | "all" }) {
  const now = Date.now();
  const todayStart = startOfDay(new Date()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60_000;
  const next7End = todayStart + 8 * 24 * 60 * 60_000;
  const weekStart = startOfWeek(new Date()).getTime();
  const weekEnd = weekStart + 7 * 24 * 60 * 60_000;
  const normalizedSearch = filters.searchText.trim().toLowerCase();
  const scopedTodos = todos.filter((todo) => {
    if (filters.priorityFilter !== "all" && todo.priority !== filters.priorityFilter) return false;
    if (!normalizedSearch) return true;
    return [todo.title, todo.notes, todo.project, ...(todo.tags ?? [])].join(" ").toLowerCase().includes(normalizedSearch);
  });
  const unfinished = scopedTodos.filter((todo) => todo.status === "open");
  const scheduledToday = unfinished
    .filter((todo) => scheduledIntersects(todo, todayStart, tomorrowStart))
    .sort((a, b) => (getScheduleStartTime(a) ?? 0) - (getScheduleStartTime(b) ?? 0));
  const scheduledTodayIds = new Set(scheduledToday.map((todo) => todo.id));
  const dueTodayUnscheduled = unfinished
    .filter((todo) => isDueInRange(todo, todayStart, tomorrowStart) && !scheduledTodayIds.has(todo.id))
    .sort(compareTodosForWork);
  const dueTodayIds = new Set(dueTodayUnscheduled.map((todo) => todo.id));
  const next7Focus = unfinished
    .filter((todo) => isDueInRange(todo, tomorrowStart, next7End) && !scheduledInRange(todo, todayStart, next7End) && !scheduledTodayIds.has(todo.id) && !dueTodayIds.has(todo.id))
    .sort(compareTodosForWork);
  const todayCreated = scopedTodos.filter((todo) => isTimeInRange(todo.createdAt, todayStart, tomorrowStart));
  const todayDone = scopedTodos.filter((todo) => todo.status === "done" && isTimeInRange(todo.completedAt ?? todo.createdAt, todayStart, tomorrowStart));
  const openTodos = scopedTodos.filter((todo) => todo.status === "open");
  const plannedToday = scopedTodos.filter((todo) => scheduledIntersects(todo, todayStart, tomorrowStart));
  const completedPlannedToday = plannedToday.filter((todo) => todo.status === "done");
  const completionRate = Math.round((todayDone.length / Math.max(1, todayDone.length + openTodos.length)) * 100);
  const scheduleCompletionRate = Math.round((completedPlannedToday.length / Math.max(1, plannedToday.length)) * 100);
  const risks = buildSummaryRisks(unfinished, now, weekStart, weekEnd);
  return { scheduledToday, dueTodayUnscheduled, next7Focus, todayCreated, todayDone, openTodos, completionRate, scheduleCompletionRate, risks };
}

export function splitDraftList(value: string) {
  return value
    .split(/[,，;；\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
