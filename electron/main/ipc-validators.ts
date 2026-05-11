/**
 * Runtime validators for IPC handler arguments.
 * Returns a sanitised value on success; throws a plain Error with a user-readable message on failure.
 * All validators guard against prototype-pollution keys (__proto__, constructor, prototype).
 */

import type {
  AppSettings,
  CodexApprovalPolicy,
  CodexCreateSessionOptions,
  CodexSandboxPolicy,
  CodexThreadSettings,
  SelectionTextAction,
  TodoCandidate,
  TodoItem,
  TodoPriority,
  TodoStatus
} from "../../shared/types.js";

// ── Primitives ──────────────────────────────────────────────────────────────

export function validateStringId(value: unknown, label = "id"): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${label}: expected a non-empty string.`);
  }
  return value.trim();
}

export function validateOptionalString(value: unknown, label = "value"): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${label}: expected string.`);
  return value;
}

export function validateBoolean(value: unknown, label = "value"): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid ${label}: expected boolean.`);
  return value;
}

export function validateFiniteNumber(value: unknown, label = "value"): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${label}: expected finite number.`);
  return value;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const POISON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected a plain object.`);
  }
  for (const key of Object.keys(value as object)) {
    if (POISON_KEYS.has(key)) throw new Error(`Invalid ${label}: forbidden key "${key}".`);
  }
}

function assertBoolean(value: unknown, key: string): void {
  if (typeof value !== "boolean") throw new Error(`settings patch key "${key}" must be a boolean.`);
}

function assertString(value: unknown, key: string): void {
  if (typeof value !== "string") throw new Error(`settings patch key "${key}" must be a string.`);
}

function assertOptionalString(value: unknown, key: string): void {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error(`settings patch key "${key}" must be a string or undefined.`);
  }
}

function sanitizeString(value: unknown, label: string, maxLength: number, optional = true): string | undefined {
  if (value === undefined || value === null) {
    if (optional) return undefined;
    throw new Error(`Invalid ${label}: expected string.`);
  }
  if (typeof value !== "string") throw new Error(`Invalid ${label}: expected string.`);
  const trimmed = value.trim();
  if (!trimmed && optional) return undefined;
  if (!trimmed) throw new Error(`Invalid ${label}: expected non-empty string.`);
  return trimmed.slice(0, maxLength);
}

function sanitizeStringArray(value: unknown, label: string, limit: number, itemMaxLength: number): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array.`);
  return value
    .map((item, index) => sanitizeString(item, `${label}[${index}]`, itemMaxLength))
    .filter((item): item is string => Boolean(item))
    .slice(0, limit);
}

function sanitizeIsoLike(value: unknown, label: string): string | undefined {
  const text = sanitizeString(value, label, 80);
  if (!text) return undefined;
  const time = new Date(text).getTime();
  if (!Number.isFinite(time)) throw new Error(`Invalid ${label}: expected a parseable date string.`);
  return text;
}

function sanitizeTodoStatus(value: unknown, label: string): TodoStatus {
  if (value !== "open" && value !== "done" && value !== "dismissed") throw new Error(`Invalid ${label}.`);
  return value;
}

function sanitizeTodoPriority(value: unknown, label: string): TodoPriority {
  if (value !== "low" && value !== "medium" && value !== "high" && value !== "urgent") throw new Error(`Invalid ${label}.`);
  return value;
}

// ── Settings ─────────────────────────────────────────────────────────────────

const BOOL_SETTINGS = new Set<keyof AppSettings>([
  "alwaysOnTop", "autoSaveTodos", "systemNotifications",
  "launchAtLogin", "keepChatHistory", "selectionToolsEnabled"
]);

const STRING_SETTINGS = new Set<keyof AppSettings>([
  "aiModel", "aiBaseUrl", "aiProviderName",
  "quickAiRecordShortcut",
  "workspaceThemeColor", "codexExecutable", "openAiModel"
]);

const OPTIONAL_STRING_SETTINGS = new Set<keyof AppSettings>([
  "aiApiKey", "openAiApiKey", "skippedUpdateVersion"
]);

const KNOWN_SETTINGS_KEYS = new Set<string>([
  "language", "aiProvider", "aiProviderName", "aiBaseUrl", "aiModel", "aiApiKey",
  "openAiApiKey", "openAiModel", "alwaysOnTop", "autoSaveTodos",
  "systemNotifications", "launchAtLogin", "keepChatHistory",
  "selectionToolsEnabled", "quickAiRecordShortcut", "workspaceThemeColor",
  "codexExecutable", "codexDefaultSandbox", "codexDefaultApproval",
  "skippedUpdateVersion", "petAppearance"
]);

export function validateSettingsPatch(value: unknown): Partial<AppSettings> {
  assertPlainObject(value, "settings patch");
  const patch = value as Record<string, unknown>;

  for (const key of Object.keys(patch)) {
    if (!KNOWN_SETTINGS_KEYS.has(key)) {
      throw new Error(`Unknown settings key: "${key}".`);
    }
    const v = patch[key];
    if (v === undefined) continue;

    if (BOOL_SETTINGS.has(key as keyof AppSettings)) assertBoolean(v, key);
    else if (STRING_SETTINGS.has(key as keyof AppSettings)) assertString(v, key);
    else if (OPTIONAL_STRING_SETTINGS.has(key as keyof AppSettings)) assertOptionalString(v, key);
    else if (key === "language") {
      if (v !== "system" && v !== "zh-CN" && v !== "en-US" && v !== "ja-JP" && v !== "ko-KR") {
        throw new Error(`settings key "language" has an invalid value.`);
      }
    } else if (key === "aiProvider") {
      if (v !== "deepseek" && v !== "openai" && v !== "custom") {
        throw new Error(`settings key "aiProvider" must be "deepseek", "openai", or "custom".`);
      }
    } else if (key === "codexDefaultSandbox") {
      if (v !== "read-only" && v !== "workspace-write" && v !== "danger-full-access") {
        throw new Error(`settings key "codexDefaultSandbox" has an invalid value.`);
      }
    } else if (key === "codexDefaultApproval") {
      if (v !== "on-request" && v !== "never") {
        throw new Error(`settings key "codexDefaultApproval" has an invalid value.`);
      }
    } else if (key === "petAppearance") {
      if (v !== null && v !== undefined) assertPlainObject(v, "petAppearance");
    }
  }

  return patch as Partial<AppSettings>;
}

// ── Todo ─────────────────────────────────────────────────────────────────────

const ALLOWED_TODO_PATCH_KEYS = new Set<string>([
  "title", "notes", "project", "tags", "priority", "status",
  "dueAt", "remindAt", "scheduledStartAt", "scheduledEndAt",
  "isAllDayScheduled", "subtasks", "attachments", "completedAt"
]);

export function validateTodoPatch(value: unknown): Partial<TodoItem> {
  assertPlainObject(value, "todo patch");
  const patch = value as Record<string, unknown>;
  const sanitized: Partial<TodoItem> = {};

  for (const key of Object.keys(patch)) {
    if (!ALLOWED_TODO_PATCH_KEYS.has(key)) {
      throw new Error(`Unknown todo patch key: "${key}".`);
    }
    const v = patch[key];
    if (v === undefined) continue;
    switch (key) {
      case "title":
        sanitized.title = sanitizeString(v, key, 120, false);
        break;
      case "notes":
      case "project":
        sanitized[key] = sanitizeString(v, key, key === "notes" ? 4000 : 160);
        break;
      case "tags":
        sanitized.tags = sanitizeStringArray(v, key, 8, 48);
        break;
      case "attachments":
        sanitized.attachments = sanitizeStringArray(v, key, 6, 500);
        break;
      case "priority":
        sanitized.priority = v === null ? undefined : sanitizeTodoPriority(v, key);
        break;
      case "status":
        sanitized.status = sanitizeTodoStatus(v, key);
        break;
      case "dueAt":
      case "remindAt":
      case "scheduledStartAt":
      case "scheduledEndAt":
      case "completedAt":
        sanitized[key] = sanitizeIsoLike(v, key);
        break;
      case "isAllDayScheduled":
        sanitized.isAllDayScheduled = validateBoolean(v, key);
        break;
      case "subtasks":
        sanitized.subtasks = sanitizeSubtasks(v, key);
        break;
    }
  }

  return sanitized;
}

function sanitizeSubtasks(value: unknown, label: string): TodoItem["subtasks"] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array.`);
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Invalid ${label}[${index}]: expected object.`);
      const input = item as Record<string, unknown>;
      return {
        id: sanitizeString(input.id, `${label}[${index}].id`, 80),
        title: sanitizeString(input.title, `${label}[${index}].title`, 120, false)!,
        done: input.done === true
      };
    })
    .slice(0, 12);
}

// ── Chat ─────────────────────────────────────────────────────────────────────

const MAX_CHAT_MESSAGE_LENGTH = 32_000;

export function validateChatMessage(value: unknown): string {
  if (typeof value !== "string") throw new Error("Message must be a string.");
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Message is empty.");
  if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new Error(`Message is too long (max ${MAX_CHAT_MESSAGE_LENGTH} characters).`);
  }
  return trimmed;
}

export function validateSelectionAction(value: unknown): SelectionTextAction {
  if (value !== "summarize" && value !== "translate") throw new Error("Unsupported selection action.");
  return value;
}

export function validateSelectedText(value: unknown, label = "selected text"): string {
  const text = sanitizeString(value, label, 8000, false)!;
  if (text.length < 1) throw new Error("Selected text is empty.");
  return text;
}

export function validateTargetLanguage(value: unknown): string {
  return sanitizeString(value, "targetLanguage", 40) || "auto";
}

export function validateSnoozeMinutes(value: unknown): number {
  const minutes = validateFiniteNumber(value, "minutes");
  if (minutes < 1 || minutes > 1440) throw new Error("Snooze minutes must be between 1 and 1440.");
  return Math.round(minutes);
}

export function validateTodoCandidates(value: unknown): TodoCandidate[] {
  if (!Array.isArray(value)) throw new Error("Todo candidates must be an array.");
  return value.slice(0, 12).map((item, index) => {
    assertPlainObject(item, `todo candidate ${index}`);
    const input = item as Record<string, unknown>;
    const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence)
      ? Math.max(0, Math.min(1, input.confidence))
      : 0.7;
    return {
      title: sanitizeString(input.title, `todo candidate ${index}.title`, 120, false)!,
      notes: sanitizeString(input.notes, `todo candidate ${index}.notes`, 4000),
      project: sanitizeString(input.project, `todo candidate ${index}.project`, 160),
      tags: sanitizeStringArray(input.tags, `todo candidate ${index}.tags`, 8, 48) ?? [],
      priority: input.priority === undefined || input.priority === null ? "medium" : sanitizeTodoPriority(input.priority, `todo candidate ${index}.priority`),
      dueAt: sanitizeIsoLike(input.dueAt, `todo candidate ${index}.dueAt`),
      remindAt: sanitizeIsoLike(input.remindAt, `todo candidate ${index}.remindAt`),
      subtasks: sanitizeSubtasks(input.subtasks, `todo candidate ${index}.subtasks`) ?? [],
      attachments: sanitizeStringArray(input.attachments, `todo candidate ${index}.attachments`, 6, 500) ?? [],
      confidence
    };
  });
}

// ── Codex ─────────────────────────────────────────────────────────────────────

export function validateCodexSessionId(value: unknown): string {
  return validateStringId(value, "sessionId");
}

export function validateCodexCreateOptions(value: unknown): CodexCreateSessionOptions {
  assertPlainObject(value ?? {}, "codex options");
  const input = (value ?? {}) as Record<string, unknown>;
  return {
    initialPrompt: sanitizeString(input.initialPrompt, "initialPrompt", 32_000) ?? "",
    sandbox: validateCodexSandbox(input.sandbox),
    approval: validateCodexApproval(input.approval)
  };
}

export function validateCodexSandbox(value: unknown): CodexSandboxPolicy {
  if (value === "read-only" || value === "workspace-write" || value === "danger-full-access") return value;
  return "workspace-write";
}

export function validateCodexApproval(value: unknown): CodexApprovalPolicy {
  return value === "never" ? "never" : "on-request";
}

export function validateCodexThreadSettings(value: unknown): Partial<CodexThreadSettings> {
  assertPlainObject(value ?? {}, "codex thread settings");
  const input = (value ?? {}) as Record<string, unknown>;
  const result: Partial<CodexThreadSettings> = {};
  if ("model" in input) result.model = sanitizeString(input.model, "model", 120);
  if ("reasoningEffort" in input) {
    const effort = input.reasoningEffort;
    if (effort === null || effort === undefined) result.reasoningEffort = null;
    else if (effort === "none" || effort === "minimal" || effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh") result.reasoningEffort = effort;
    else throw new Error("Invalid reasoning effort.");
  }
  if ("mode" in input) {
    if (input.mode === "default" || input.mode === "plan") result.mode = input.mode;
    else throw new Error("Invalid Codex thread mode.");
  }
  return result;
}
