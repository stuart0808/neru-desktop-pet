import { Notification } from "electron";
import { randomUUID } from "node:crypto";
import { JsonStore } from "./storage.js";
import { state } from "./state.js";
import { broadcastSnapshotUpdated } from "./broadcast.js";
import { getNotificationIconPath } from "./windowUtils.js";
import type { ReminderItem, TodoItem } from "../../shared/types.js";

const store = new JsonStore();

// Injected by main.ts to avoid a circular dependency (reminder.ts ↔ window.ts).
let _openWorkspaceWindow: ((todoId?: string) => Promise<void>) | null = null;

export function setOpenWorkspaceWindow(fn: (todoId?: string) => Promise<void>): void {
  _openWorkspaceWindow = fn;
}

export async function openReminderTarget(reminder: ReminderItem): Promise<void> {
  if (_openWorkspaceWindow) await _openWorkspaceWindow(reminder.todoId);
}

export async function completeReminder(id: string): Promise<ReminderItem> {
  const reminder = await store.updateReminder(id, { dismissedAt: new Date().toISOString() });
  if (reminder.todoId) {
    await store.updateTodo(reminder.todoId, { status: "done" });
  }
  await refreshReminderTimers();
  broadcastSnapshotUpdated();
  return reminder;
}

export async function snoozeReminder(id: string, minutes: number): Promise<ReminderItem> {
  const reminder = await store.updateReminder(id, {
    firedAt: undefined,
    dismissedAt: undefined,
    snoozedUntil: new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString()
  });
  await refreshReminderTimers();
  broadcastSnapshotUpdated();
  return reminder;
}

export async function refreshReminderTimers(): Promise<void> {
  for (const timer of state.reminderTimers.values()) clearTimeout(timer);
  state.reminderTimers.clear();

  const reminders = await store.listReminders();
  const now = Date.now();
  for (const reminder of reminders) {
    if (reminder.dismissedAt || reminder.firedAt) continue;
    const fireAt = new Date(reminder.snoozedUntil ?? reminder.remindAt).getTime();
    if (!Number.isFinite(fireAt)) continue;
    const delay = Math.max(0, fireAt - now);
    const timer = setTimeout(() => void fireReminder(reminder.id), delay);
    state.reminderTimers.set(reminder.id, timer);
  }
}

export async function fireReminder(id: string): Promise<void> {
  const reminder = await store.updateReminder(id, { firedAt: new Date().toISOString() });
  await showReminder(reminder);
}

export async function showReminder(reminder: ReminderItem): Promise<void> {
  const settings = await store.getSettings();
  state.mainWindow?.webContents.send("reminder:fired", reminder);
  state.workspaceWindow?.webContents.send("reminder:fired", reminder);
  state.mainWindow?.show();

  if (settings.systemNotifications && Notification.isSupported()) {
    const notification = new Notification({
      title: reminder.title,
      body: reminder.message || "有一个待办提醒到了。",
      icon: getNotificationIconPath(),
      timeoutType: "never",
      actions: reminder.todoId
        ? [
            { type: "button", text: "完成" },
            { type: "button", text: "10 分钟后提醒" },
            { type: "button", text: "打开待办" }
          ]
        : undefined
    });
    notification.on("click", () => {
      void openReminderTarget(reminder);
    });
    notification.on("action", (details, actionIndex) => {
      const index = details.actionIndex ?? actionIndex;
      if (index === 0) void completeReminder(reminder.id);
      else if (index === 1) void snoozeReminder(reminder.id, 10);
      else void openReminderTarget(reminder);
    });
    notification.show();
  }
}

export function createReminder(todo: TodoItem, message?: string): ReminderItem | null {
  if (todo.status !== "open") return null;
  if (!todo.remindAt) return null;
  return {
    id: randomUUID(),
    todoId: todo.id,
    title: todo.title,
    message: message ?? `该处理：${todo.title}`,
    remindAt: todo.remindAt
  };
}
