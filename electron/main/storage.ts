import { app, safeStorage } from "electron";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AppSettings, ConversationMessage, ReminderItem, TodoItem } from "../../shared/types.js";

interface PersistedState {
  todos: TodoItem[];
  reminders: ReminderItem[];
  messages: ConversationMessage[];
  settings: AppSettings;
  lastAutoSavedTodoId?: string;
}

// API key fields are stored encrypted separately — never written to the main JSON.
type SettingsOnDisk = Omit<AppSettings, "aiApiKey" | "openAiApiKey">;

const defaultSettings: AppSettings = {
  language: "system",
  aiProvider: "deepseek",
  aiProviderName: "DeepSeek",
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-v4-flash",
  aiApiKey: undefined,
  openAiApiKey: undefined,
  openAiModel: "deepseek-v4-flash",
  alwaysOnTop: true,
  autoSaveTodos: true,
  systemNotifications: true,
  launchAtLogin: false,
  keepChatHistory: true,
  selectionToolsEnabled: true,
  quickAiRecordShortcut: "CommandOrControl+Shift+Space",
  workspaceThemeColor: "#5aa982",
  codexExecutable: "codex",
  codexDefaultSandbox: "workspace-write",
  codexDefaultApproval: "on-request",
  skippedUpdateVersion: undefined
};

export class JsonStore {
  private static sharedState: PersistedState | null = null;
  private readonly filePath = join(app.getPath("userData"), "neru-desktop-pet.json");
  private readonly keyFilePath = join(app.getPath("userData"), "neru-api-key.enc");
  private readonly backupFilePath = `${this.filePath}.bak`;

  async load(): Promise<PersistedState> {
    if (JsonStore.sharedState) return JsonStore.sharedState;

    try {
      const parsed = await this.readPersistedState();

      // Attempt to load the encrypted key first.
      let apiKey = await this.loadEncryptedApiKey();

      // Migration: if the legacy JSON has a plaintext key and we can encrypt, migrate it now.
      const legacyKey = (parsed.settings as Partial<AppSettings> | undefined)?.aiApiKey
        ?? (parsed.settings as Partial<AppSettings> | undefined)?.openAiApiKey;
      if (legacyKey && !apiKey) {
        if (safeStorage.isEncryptionAvailable()) {
          await this.saveEncryptedApiKey(legacyKey);
          apiKey = legacyKey;
        } else {
          apiKey = legacyKey;
          console.warn("Electron safeStorage is not available; legacy API key is available only until settings are saved.");
        }
      }

      JsonStore.sharedState = {
        todos: parsed.todos ?? [],
        reminders: parsed.reminders ?? [],
        messages: parsed.messages ?? [],
        settings: normalizeSettings({ ...defaultSettings, ...parsed.settings, aiApiKey: apiKey }),
        lastAutoSavedTodoId: parsed.lastAutoSavedTodoId
      };
      // Persist immediately to strip plaintext key from JSON (migration) and normalise.
      await this.save();
    } catch {
      JsonStore.sharedState = {
        todos: [],
        reminders: [],
        messages: [],
        settings: normalizeSettings(defaultSettings)
      };
      await this.save();
    }

    return JsonStore.sharedState;
  }

  async snapshot(): Promise<PersistedState> {
    const state = await this.load();
    return structuredClone(state);
  }

  async save(): Promise<void> {
    if (!JsonStore.sharedState) return;
    await mkdir(dirname(this.filePath), { recursive: true });

    // Strip API key fields — these live in the encrypted key file only.
    const { aiApiKey: _a, openAiApiKey: _b, ...settingsOnDisk } = JsonStore.sharedState.settings;
    const payload: Omit<PersistedState, "settings"> & { settings: SettingsOnDisk } = {
      ...JsonStore.sharedState,
      settings: settingsOnDisk as SettingsOnDisk
    };

    // Atomic write: write to .tmp then rename, keeping .bak for crash recovery.
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
    // Best-effort backup of the previous version.
    try {
      await copyFile(this.filePath, this.backupFilePath);
    } catch {
      // No previous file yet — fine.
    }
    await rename(tmpPath, this.filePath);
  }

  async getSettings(): Promise<AppSettings> {
    const settings = (await this.load()).settings;
    // Re-read encrypted key in case it changed outside this session (unlikely, but correct).
    if (!settings.aiApiKey) {
      const key = await this.loadEncryptedApiKey();
      if (key) return { ...settings, aiApiKey: key, openAiApiKey: key };
    }
    return settings;
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const state = await this.load();

    // Handle API key separately via encrypted storage.
    if ("aiApiKey" in patch || "openAiApiKey" in patch) {
      const key = patch.aiApiKey ?? patch.openAiApiKey ?? undefined;
      if (key?.trim()) {
        await this.saveEncryptedApiKey(key.trim());
      } else {
        await this.clearEncryptedApiKey();
      }
      // Keep in-memory state consistent.
    }

    state.settings = normalizeSettings({ ...state.settings, ...patch });
    await this.save();
    return state.settings;
  }

  async addMessage(message: ConversationMessage): Promise<void> {
    const state = await this.load();
    if (state.settings.keepChatHistory) {
      state.messages.push(message);
      state.messages = state.messages.slice(-80);
      await this.save();
    }
  }

  async listMessages(): Promise<ConversationMessage[]> {
    return (await this.load()).messages;
  }

  async updateMessage(id: string, patch: Partial<ConversationMessage>): Promise<ConversationMessage> {
    const state = await this.load();
    const index = state.messages.findIndex((message) => message.id === id);
    if (index < 0) throw new Error("Message not found");
    state.messages[index] = { ...state.messages[index], ...patch };
    await this.save();
    return state.messages[index];
  }

  async clearMessages(): Promise<void> {
    const state = await this.load();
    state.messages = [];
    await this.save();
  }

  async addTodo(todo: TodoItem, autoSaved = false): Promise<void> {
    const state = await this.load();
    state.todos.unshift(todo);
    if (autoSaved) state.lastAutoSavedTodoId = todo.id;
    await this.save();
  }

  async listTodos(): Promise<TodoItem[]> {
    return (await this.load()).todos;
  }

  async updateTodo(id: string, patch: Partial<TodoItem>): Promise<TodoItem> {
    const state = await this.load();
    const index = state.todos.findIndex((todo) => todo.id === id);
    if (index < 0) throw new Error("Todo not found");
    state.todos[index] = { ...state.todos[index], ...patch };
    await this.save();
    return state.todos[index];
  }

  async deleteTodo(id: string): Promise<TodoItem> {
    const state = await this.load();
    const index = state.todos.findIndex((todo) => todo.id === id);
    if (index < 0) throw new Error("Todo not found");
    const [removed] = state.todos.splice(index, 1);
    state.reminders = state.reminders.filter((reminder) => reminder.todoId !== id);
    if (state.lastAutoSavedTodoId === id) state.lastAutoSavedTodoId = undefined;
    await this.save();
    return removed;
  }

  async undoLastAutoSave(): Promise<TodoItem | null> {
    const state = await this.load();
    if (!state.lastAutoSavedTodoId) return null;
    const index = state.todos.findIndex((todo) => todo.id === state.lastAutoSavedTodoId);
    if (index < 0) {
      state.lastAutoSavedTodoId = undefined;
      await this.save();
      return null;
    }
    const [removed] = state.todos.splice(index, 1);
    state.lastAutoSavedTodoId = undefined;
    await this.save();
    return removed;
  }

  async addReminder(reminder: ReminderItem): Promise<void> {
    const state = await this.load();
    state.reminders.unshift(reminder);
    await this.save();
  }

  async listReminders(): Promise<ReminderItem[]> {
    return (await this.load()).reminders;
  }

  async updateReminder(id: string, patch: Partial<ReminderItem>): Promise<ReminderItem> {
    const state = await this.load();
    const index = state.reminders.findIndex((reminder) => reminder.id === id);
    if (index < 0) throw new Error("Reminder not found");
    state.reminders[index] = { ...state.reminders[index], ...patch };
    await this.save();
    return state.reminders[index];
  }

  async replaceReminderForTodo(todoId: string, reminder: ReminderItem | null): Promise<void> {
    const state = await this.load();
    state.reminders = state.reminders.filter((item) => item.todoId !== todoId);
    if (reminder) state.reminders.unshift(reminder);
    await this.save();
  }

  // ── Encrypted key helpers ───────────────────────────────────────────────────

  private async loadEncryptedApiKey(): Promise<string | undefined> {
    if (!safeStorage.isEncryptionAvailable()) return undefined;
    try {
      const buf = await readFile(this.keyFilePath);
      return safeStorage.decryptString(buf);
    } catch {
      return undefined;
    }
  }

  private async saveEncryptedApiKey(key: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统环境不支持安全保存访问密钥。请改用环境变量，或在本次会话中临时测试。");
    }
    const encrypted = safeStorage.encryptString(key);
    const tmpPath = `${this.keyFilePath}.tmp`;
    await writeFile(tmpPath, encrypted);
    try {
      await rename(this.keyFilePath, `${this.keyFilePath}.bak`);
    } catch {
      // No previous key file yet.
    }
    await rename(tmpPath, this.keyFilePath);
  }

  private async clearEncryptedApiKey(): Promise<void> {
    try {
      await unlink(this.keyFilePath);
    } catch {
      // Already absent.
    }
  }

  private async readPersistedState(): Promise<Partial<PersistedState>> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as Partial<PersistedState>;
    } catch (primaryError) {
      try {
        const backupRaw = await readFile(this.backupFilePath, "utf8");
        const backup = JSON.parse(backupRaw) as Partial<PersistedState>;
        await writeFile(this.filePath, JSON.stringify(backup, null, 2), "utf8");
        console.warn("Recovered Neru state from backup after primary state read failed.", primaryError);
        return backup;
      } catch {
        throw primaryError;
      }
    }
  }
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const provider = settings.aiProvider === "openai" || settings.aiProvider === "custom" ? settings.aiProvider : "deepseek";
  const preset = getProviderPreset(provider);
  const legacyModel = settings.openAiModel || "deepseek-v4-flash";
  const aiModel = normalizeNonEmptyString(settings.aiModel) ?? legacyModel;
  const aiApiKey = normalizeOptionalString(settings.aiApiKey ?? settings.openAiApiKey);
  const aiBaseUrl = normalizeOptionalString(settings.aiBaseUrl) ?? preset.baseUrl;
  return {
    ...settings,
    language: normalizeLanguage(settings.language),
    aiProvider: provider,
    aiProviderName: provider === "custom"
      ? normalizeNonEmptyString(settings.aiProviderName) ?? "自定义提供商"
      : preset.name,
    aiBaseUrl,
    aiModel,
    aiApiKey,
    openAiApiKey: aiApiKey,
    openAiModel: aiModel,
    selectionToolsEnabled: settings.selectionToolsEnabled !== false,
    quickAiRecordShortcut: normalizeNonEmptyString(settings.quickAiRecordShortcut) ?? "CommandOrControl+Shift+Space",
    workspaceThemeColor: normalizeThemeColor(settings.workspaceThemeColor),
    codexExecutable: normalizeNonEmptyString(settings.codexExecutable) ?? "codex",
    codexDefaultSandbox: normalizeCodexSandbox(settings.codexDefaultSandbox),
    codexDefaultApproval: normalizeCodexApproval(settings.codexDefaultApproval),
    skippedUpdateVersion: normalizeOptionalString(settings.skippedUpdateVersion),
    petAppearance: settings.petAppearance?.directory ? settings.petAppearance : undefined
  };
}

function normalizeLanguage(value: AppSettings["language"] | undefined): AppSettings["language"] {
  return value === "zh-CN" || value === "en-US" || value === "ja-JP" || value === "ko-KR" ? value : "system";
}

function normalizeCodexSandbox(value: AppSettings["codexDefaultSandbox"] | undefined): AppSettings["codexDefaultSandbox"] {
  if (value === "read-only" || value === "danger-full-access") return value;
  return "workspace-write";
}

function normalizeCodexApproval(value: AppSettings["codexDefaultApproval"] | undefined): AppSettings["codexDefaultApproval"] {
  return value === "never" ? "never" : "on-request";
}

function getProviderPreset(provider: AppSettings["aiProvider"]) {
  switch (provider) {
    case "openai":
      return { name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
    case "custom":
      return { name: "自定义提供商", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" };
    case "deepseek":
    default:
      return { name: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" };
  }
}

function normalizeNonEmptyString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return normalizeNonEmptyString(value);
}

function normalizeThemeColor(value: string | undefined): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#5aa982";
}
