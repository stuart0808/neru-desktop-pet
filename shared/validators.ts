import type { AppLanguage, AppSettings, ConversationMessage, ReminderItem, TodoItem, TodoPriority, TodoStatus } from "./types.js";

function assertString(v: unknown, label: string): string {
  if (typeof v !== "string") throw new TypeError(`${label}: expected string, got ${typeof v}`);
  return v;
}

function assertBoolean(v: unknown, label: string): boolean {
  if (typeof v !== "boolean") throw new TypeError(`${label}: expected boolean, got ${typeof v}`);
  return v;
}

function assertStringOrUndefined(v: unknown, label: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  return assertString(v, label);
}

function assertBooleanOrUndefined(v: unknown, label: string): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  return assertBoolean(v, label);
}

function isValidTodoStatus(v: unknown): v is TodoStatus {
  return v === "open" || v === "done" || v === "dismissed";
}

function isValidTodoPriority(v: unknown): v is TodoPriority {
  return v === "low" || v === "medium" || v === "high" || v === "urgent";
}

export function assertTodoItem(v: unknown): TodoItem {
  if (!v || typeof v !== "object") throw new TypeError("TodoItem: expected object");
  const o = v as Record<string, unknown>;
  const id = assertString(o["id"], "TodoItem.id");
  const title = assertString(o["title"], "TodoItem.title");
  const status = isValidTodoStatus(o["status"]) ? o["status"] : "open";
  const createdAt = assertString(o["createdAt"] ?? new Date().toISOString(), "TodoItem.createdAt");
  const priority = isValidTodoPriority(o["priority"]) ? o["priority"] : undefined;
  const item: TodoItem = { id, title, status, createdAt };
  if (priority) item.priority = priority;
  if (typeof o["notes"] === "string") item.notes = o["notes"];
  if (typeof o["project"] === "string") item.project = o["project"];
  if (Array.isArray(o["tags"])) item.tags = o["tags"].filter((t) => typeof t === "string");
  if (typeof o["dueAt"] === "string") item.dueAt = o["dueAt"];
  if (typeof o["remindAt"] === "string") item.remindAt = o["remindAt"];
  if (typeof o["scheduledStartAt"] === "string") item.scheduledStartAt = o["scheduledStartAt"];
  if (typeof o["scheduledEndAt"] === "string") item.scheduledEndAt = o["scheduledEndAt"];
  if (typeof o["isAllDayScheduled"] === "boolean") item.isAllDayScheduled = o["isAllDayScheduled"];
  if (typeof o["sourceMessage"] === "string") item.sourceMessage = o["sourceMessage"];
  if (typeof o["completedAt"] === "string") item.completedAt = o["completedAt"];
  if (typeof o["confirmedAt"] === "string") item.confirmedAt = o["confirmedAt"];
  if (Array.isArray(o["subtasks"])) {
    item.subtasks = o["subtasks"]
      .filter((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>)["title"] === "string")
      .map((s) => {
        const st = s as Record<string, unknown>;
        return {
          id: typeof st["id"] === "string" ? st["id"] : undefined,
          title: st["title"] as string,
          done: typeof st["done"] === "boolean" ? st["done"] : false
        };
      });
  }
  if (Array.isArray(o["attachments"])) item.attachments = o["attachments"].filter((a) => typeof a === "string");
  if (typeof o["confidence"] === "number") item.confidence = o["confidence"];
  return item;
}

export function assertReminderItem(v: unknown): ReminderItem {
  if (!v || typeof v !== "object") throw new TypeError("ReminderItem: expected object");
  const o = v as Record<string, unknown>;
  const id = assertString(o["id"], "ReminderItem.id");
  const title = assertString(o["title"], "ReminderItem.title");
  const message = assertString(o["message"], "ReminderItem.message");
  const remindAt = assertString(o["remindAt"], "ReminderItem.remindAt");
  const item: ReminderItem = { id, title, message, remindAt };
  if (typeof o["todoId"] === "string") item.todoId = o["todoId"];
  if (typeof o["firedAt"] === "string") item.firedAt = o["firedAt"];
  if (typeof o["dismissedAt"] === "string") item.dismissedAt = o["dismissedAt"];
  if (typeof o["snoozedUntil"] === "string") item.snoozedUntil = o["snoozedUntil"];
  return item;
}

export function assertConversationMessage(v: unknown): ConversationMessage {
  if (!v || typeof v !== "object") throw new TypeError("ConversationMessage: expected object");
  const o = v as Record<string, unknown>;
  const id = assertString(o["id"], "ConversationMessage.id");
  const text = assertString(o["text"], "ConversationMessage.text");
  const createdAt = assertString(o["createdAt"] ?? new Date().toISOString(), "ConversationMessage.createdAt");
  const rawRole = o["role"];
  const role: ConversationMessage["role"] = rawRole === "user" || rawRole === "assistant" || rawRole === "system" ? rawRole : "assistant";
  return { id, role, text, createdAt };
}

export function assertAppSettings(v: unknown): AppSettings {
  if (!v || typeof v !== "object") throw new TypeError("AppSettings: expected object");
  const o = v as Record<string, unknown>;
  const provider = o["aiProvider"] === "openai" || o["aiProvider"] === "custom" ? o["aiProvider"] : "deepseek";
  const language = isValidAppLanguage(o["language"]) ? o["language"] : "system";
  return {
    language,
    aiProvider: provider,
    aiProviderName: assertStringOrUndefined(o["aiProviderName"], "aiProviderName"),
    aiBaseUrl: assertStringOrUndefined(o["aiBaseUrl"], "aiBaseUrl"),
    aiModel: typeof o["aiModel"] === "string" && o["aiModel"].trim() ? o["aiModel"].trim() : "deepseek-v4-flash",
    aiApiKey: assertStringOrUndefined(o["aiApiKey"] ?? o["openAiApiKey"], "aiApiKey"),
    openAiApiKey: assertStringOrUndefined(o["openAiApiKey"] ?? o["aiApiKey"], "openAiApiKey"),
    openAiModel: typeof o["openAiModel"] === "string" && o["openAiModel"].trim() ? o["openAiModel"].trim() : "deepseek-v4-flash",
    alwaysOnTop: assertBooleanOrUndefined(o["alwaysOnTop"], "alwaysOnTop") ?? false,
    autoSaveTodos: assertBooleanOrUndefined(o["autoSaveTodos"], "autoSaveTodos") ?? true,
    systemNotifications: assertBooleanOrUndefined(o["systemNotifications"], "systemNotifications") ?? true,
    launchAtLogin: assertBooleanOrUndefined(o["launchAtLogin"], "launchAtLogin") ?? false,
    keepChatHistory: assertBooleanOrUndefined(o["keepChatHistory"], "keepChatHistory") ?? true,
    selectionToolsEnabled: o["selectionToolsEnabled"] !== false,
    quickAiRecordShortcut: typeof o["quickAiRecordShortcut"] === "string" && o["quickAiRecordShortcut"].trim()
      ? o["quickAiRecordShortcut"].trim()
      : "CommandOrControl+Shift+Space",
    workspaceThemeColor: typeof o["workspaceThemeColor"] === "string" && /^#[0-9a-fA-F]{6}$/.test(o["workspaceThemeColor"])
      ? o["workspaceThemeColor"]
      : "#5aa982",
    codexExecutable: typeof o["codexExecutable"] === "string" && o["codexExecutable"].trim()
      ? o["codexExecutable"].trim()
      : "codex",
    codexDefaultSandbox: o["codexDefaultSandbox"] === "read-only" || o["codexDefaultSandbox"] === "danger-full-access"
      ? o["codexDefaultSandbox"]
      : "workspace-write",
    codexDefaultApproval: o["codexDefaultApproval"] === "never" ? "never" : "on-request",
    skippedUpdateVersion: assertStringOrUndefined(o["skippedUpdateVersion"], "skippedUpdateVersion"),
    petAppearance: o["petAppearance"] && typeof (o["petAppearance"] as Record<string, unknown>)["directory"] === "string"
      ? o["petAppearance"] as AppSettings["petAppearance"]
      : undefined
  };
}

function isValidAppLanguage(value: unknown): value is AppLanguage {
  return value === "system" || value === "zh-CN" || value === "en-US" || value === "ja-JP" || value === "ko-KR";
}
