import { app, BrowserWindow, dialog, ipcMain, shell, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { askPetAssistant, summarizeRecentContext, testAiConnection } from "./openaiClient.js";
import { JsonStore } from "./storage.js";
import {
  validateBoolean,
  validateChatMessage,
  validateCodexCreateOptions,
  validateCodexSessionId,
  validateCodexThreadSettings,
  validateFiniteNumber,
  validateSelectedText,
  validateSelectionAction,
  validateSettingsPatch,
  validateSnoozeMinutes,
  validateStringId,
  validateTargetLanguage,
  validateTodoCandidates,
  validateTodoPatch
} from "./ipc-validators.js";
import { state } from "./state.js";
import { broadcastSnapshotUpdated, broadcastCodexEvent } from "./broadcast.js";
import { completeReminder, createReminder, refreshReminderTimers, showReminder, snoozeReminder } from "./reminder.js";
import { syncGlobalSelectionHook, resolveSelectionCapture, getSelectionAskDraft, submitSelectionAskDraft } from "./selection.js";
import {
  createCodexSession, createCodexSessionFromFolder, listSavedCodexSessions,
  openSavedCodexSession, renameSavedCodexSession, deleteSavedCodexSession,
  listCodexModels, listCodexThreads, resumeCodexThread, newCodexThread,
  getCodexSession, startCodexSession, sendCodexInput, setCodexThreadSettings,
  respondCodexRequest, updateCodexSessionHistory, saveCodexSession, discardCodexSession,
  stopCodexRuntimeSession, publicCodexSessionInfo, clearClosedCodexTempSessions
} from "./codex.js";
import {
  setPetWindowExpanded, setPetWindowLayout, openWorkspaceWindow, openSelectionResultWindow,
  processSelectionResultInBackground, resizeSelectionPopoverWindow,
  resolveAiConfig, beginWindowDrag, dragWindowToCursor, endWindowDrag, registerQuickAiRecordShortcut, refreshTrayMenu
} from "./window.js";
import { checkForUpdates } from "./updates.js";
import type { ChatResult, CodexDropItem, CodexSessionHistory, ConversationMessage, PetAppearance, PetWindowLayout, ReminderItem, SelectionTextResult, TodoCandidate, TodoItem } from "../../shared/types.js";
import type { OpenDialogOptions } from "electron";
import { resolveLocale, translate } from "../../shared/i18n.js";

const store = new JsonStore();

const petStateNames = ["Idle", "Talking", "Happy", "Thinking", "Reminder", "Confused", "Dragging", "Urgent", "Rest", "Sleepy"] as const;
const supportedPetImageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);

function normalizeMaybeIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

function getLocalTimeContext(now = new Date()) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  const localTimeText = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset"
  }).format(now);
  return { nowIso: now.toISOString(), localTimeText, timeZone };
}

function createTodo(candidate: {
  title: string;
  notes?: string | null;
  project?: string | null;
  tags?: string[];
  priority?: TodoItem["priority"];
  dueAt?: string | null;
  remindAt?: string | null;
  subtasks?: TodoItem["subtasks"];
  attachments?: string[];
  confidence?: number;
}, sourceMessage: string): TodoItem {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: candidate.title.trim().slice(0, 120),
    notes: candidate.notes ?? undefined,
    project: normalizeOptionalText(candidate.project),
    tags: normalizeTextArray(candidate.tags, 8),
    priority: candidate.priority ?? "medium",
    sourceMessage,
    status: "open",
    createdAt: now,
    dueAt: normalizeMaybeIso(candidate.dueAt),
    remindAt: normalizeMaybeIso(candidate.remindAt),
    subtasks: normalizeSubtasksForTodo(candidate.subtasks),
    attachments: normalizeTextArray(candidate.attachments, 6),
    confidence: candidate.confidence,
    confirmedAt: now
  };
}

async function saveTodoCandidates(candidates: TodoCandidate[], sourceMessage: string, autoSaved: boolean) {
  const todos: TodoItem[] = [];
  const reminders: ReminderItem[] = [];
  for (const candidate of candidates) {
    if (!candidate.title?.trim() || candidate.confidence < 0.45) continue;
    const todo = createTodo(candidate, sourceMessage);
    await store.addTodo(todo, autoSaved);
    todos.push(todo);
    const reminder = createReminder(todo);
    if (reminder) {
      await store.addReminder(reminder);
      reminders.push(reminder);
    }
  }
  if (todos.length || reminders.length) await refreshReminderTimers();
  return { todos, reminders };
}

function buildTaskDraftProposal(modelResult: Awaited<ReturnType<typeof askPetAssistant>>, sourceMessage: string) {
  if (modelResult.planProposal?.items.length) {
    return {
      ...modelResult.planProposal,
      sourceMessage: modelResult.planProposal.sourceMessage || sourceMessage,
      needsConfirmation: true
    };
  }
  if (!modelResult.todoCandidates.length) return null;
  return {
    summary: modelResult.todoCandidates.length === 1 ? "待办草案" : `待办草案（${modelResult.todoCandidates.length} 项）`,
    sourceMessage,
    needsConfirmation: true,
    items: modelResult.todoCandidates
  };
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeTextArray(value: string[] | undefined, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item.trim()).filter(Boolean).slice(0, limit);
}

function normalizeSubtasksForTodo(value: TodoItem["subtasks"]): NonNullable<TodoItem["subtasks"]> {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const title = item.title?.trim();
      if (!title) return null;
      return {
        id: item.id || randomUUID(),
        title: title.slice(0, 120),
        done: item.done === true
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 12);
}

async function selectPetAppearance(sender: WebContents): Promise<PetAppearance | null> {
  const owner = BrowserWindow.fromWebContents(sender) ?? state.workspaceWindow ?? state.mainWindow;
  const options: OpenDialogOptions = {
    title: "选择桌宠形象文件夹",
    properties: ["openDirectory"]
  };
  const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return null;
  const appearance = await scanPetAppearanceFolder(result.filePaths[0]);
  const next = await store.updateSettings({ petAppearance: appearance });
  broadcastSnapshotUpdated(sender);
  return next.petAppearance ?? appearance;
}

async function scanPetAppearanceFolder(directory: string): Promise<PetAppearance> {
  const folderName = basename(directory);
  if (!folderName.endsWith("_state")) {
    throw new Error("形象文件夹名称需要以 _state 结尾，例如 Neru_state。");
  }
  const roleName = folderName.slice(0, -"_state".length) || "自定义角色";
  const entries = await readdir(directory, { withFileTypes: true });
  const images: PetAppearance["images"] = {};

  for (const stateName of petStateNames) {
    const match = entries.find((entry) => {
      if (!entry.isFile()) return false;
      const extension = extname(entry.name).toLowerCase();
      if (!supportedPetImageExtensions.has(extension)) return false;
      const nameWithoutExtension = basename(entry.name, extension).toLowerCase();
      return nameWithoutExtension === `_${stateName.toLowerCase()}_`;
    });
    if (match) images[stateName.toLowerCase()] = pathToFileURL(join(directory, match.name)).toString();
  }

  if (!images.idle) {
    throw new Error("形象文件夹至少需要包含 _Idle_ 图片文件，例如 _Idle_.png。");
  }
  return { name: roleName, directory, images };
}

function validatePetWindowLayout(value: unknown): PetWindowLayout {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid pet window layout.");
  }
  const layout = value as Record<string, unknown>;
  const readSize = (key: "collapsed" | "expanded") => {
    const size = layout[key];
    if (size === null || typeof size !== "object" || Array.isArray(size)) {
      throw new Error(`Invalid pet window layout ${key}.`);
    }
    const record = size as Record<string, unknown>;
    return {
      width: validateFiniteNumber(record.width, `${key}.width`),
      height: validateFiniteNumber(record.height, `${key}.height`)
    };
  };
  return {
    collapsed: readSize("collapsed"),
    expanded: readSize("expanded")
  };
}

export function registerIpc(): void {
  ipcMain.handle("app:snapshot", () => store.snapshot());
  ipcMain.handle("app:setIgnoreMouseEvents", (_event, ignore: unknown) => {
    const ignoreValue = validateBoolean(ignore, "ignore");
    state.mainWindow?.setIgnoreMouseEvents(ignoreValue, { forward: true });
    state.mainWindowIgnoringMouseEvents = ignoreValue;
  });
  ipcMain.handle("app:moveWindowBy", (_event, deltaX: unknown, deltaY: unknown) => {
    const targetWindow = BrowserWindow.fromWebContents(_event.sender) ?? state.mainWindow;
    if (!targetWindow) return;
    const [x, y] = targetWindow.getPosition();
    targetWindow.setPosition(Math.round(x + validateFiniteNumber(deltaX, "deltaX")), Math.round(y + validateFiniteNumber(deltaY, "deltaY")));
  });
  ipcMain.handle("app:beginWindowDrag", (_event) => {
    beginWindowDrag(_event.sender);
  });
  ipcMain.on("app:dragWindowToCursor", () => {
    dragWindowToCursor();
  });
  ipcMain.handle("app:endWindowDrag", () => {
    endWindowDrag();
  });
  ipcMain.handle("app:setPetWindowExpanded", (_event, expanded: unknown) => {
    setPetWindowExpanded(validateBoolean(expanded, "expanded"));
  });
  ipcMain.handle("app:setPetWindowLayout", (_event, layout: unknown) => {
    setPetWindowLayout(validatePetWindowLayout(layout));
  });
  ipcMain.handle("app:openWorkspaceWindow", (_event, todoId?: unknown) => openWorkspaceWindow(todoId === undefined ? undefined : validateStringId(todoId, "todoId")));
  ipcMain.handle("app:checkForUpdates", () => checkForUpdates(true));
  ipcMain.handle("app:openPath", async (_event, filePath: unknown): Promise<{ ok: boolean; message?: string }> => {
    if (typeof filePath !== "string" || !filePath.trim()) {
      return { ok: false, message: "路径不能为空。" };
    }
    const targetPath = filePath.trim();
    if (!isAbsolute(targetPath)) {
      return { ok: false, message: `只能打开绝对路径：${targetPath}` };
    }
    const targetStat = await stat(targetPath).catch(() => null);
    if (!targetStat) {
      return { ok: false, message: `路径不存在：${targetPath}` };
    }
    try {
      if (targetStat.isDirectory()) {
        const errorMessage = await shell.openPath(targetPath);
        return errorMessage ? { ok: false, message: errorMessage } : { ok: true };
      }
      shell.showItemInFolder(targetPath);
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : "打开路径失败。" };
    }
  });

  ipcMain.handle("chat:listMessages", () => store.listMessages());
  ipcMain.handle("chat:clearMessages", async (_event) => {
    await store.clearMessages();
    broadcastSnapshotUpdated(_event.sender);
  });
  ipcMain.handle("chat:testApi", async (_event, apiKeyOverride?: unknown): Promise<{ ok: boolean; message: string }> => {
    const settings = await store.getSettings();
    const ai = resolveAiConfig(settings, typeof apiKeyOverride === "string" ? apiKeyOverride : undefined);
    const locale = resolveLocale(settings.language, app.getLocale());
    try {
      await testAiConnection({ ...ai, locale });
      return { ok: true, message: translate(locale, "{provider} 模型服务连接正常，模型 {model} 可用。", { provider: ai.providerName ?? translate(locale, "模型服务"), model: ai.model }) };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : translate(locale, "连接测试失败。")
      };
    }
  });
  ipcMain.handle("chat:sendMessage", async (_event, text: unknown): Promise<ChatResult> => {
    const trimmed = validateChatMessage(text);

    const userMessage: ConversationMessage = {
      id: randomUUID(),
      role: "user",
      text: trimmed,
      createdAt: new Date().toISOString()
    };
    await store.addMessage(userMessage);

    const settings = await store.getSettings();
    const ai = resolveAiConfig(settings);
    const timeContext = getLocalTimeContext();
    const locale = resolveLocale(settings.language, app.getLocale());
    const modelResult = await askPetAssistant({
      ...ai,
      locale,
      text: trimmed,
      ...timeContext
    });

    const taskDraftProposal = buildTaskDraftProposal(modelResult, trimmed);
    const assistantMessage: ConversationMessage = {
      id: randomUUID(),
      role: "assistant",
      text: modelResult.replyText,
      createdAt: new Date().toISOString(),
      taskDraftProposal,
      taskDraftStatus: taskDraftProposal ? "pending" : undefined
    };
    await store.addMessage(assistantMessage);

    broadcastSnapshotUpdated(_event.sender);

    return {
      assistantMessage,
      extractedTodos: [],
      reminders: [],
      mood: modelResult.mood,
      taskDraftProposal,
      planProposal: taskDraftProposal
    };
  });

  ipcMain.handle("todo:list", () => store.listTodos());
  ipcMain.handle("chat:updateTaskDraft", async (_event, messageId: unknown, patch: Partial<ConversationMessage>) => {
    const updated = await store.updateMessage(validateStringId(messageId, "messageId"), {
      taskDraftProposal: patch.taskDraftProposal,
      taskDraftStatus: patch.taskDraftStatus
    });
    broadcastSnapshotUpdated(_event.sender);
    return updated;
  });
  ipcMain.handle("todo:acceptPlanProposal", async (_event, items: unknown, sourceMessage: unknown, messageId?: unknown) => {
    const validItems = validateTodoCandidates(items);
    const validSourceMessage = validateChatMessage(sourceMessage);
    const validMessageId = messageId === undefined ? undefined : validateStringId(messageId, "messageId");
    const saved = await saveTodoCandidates(validItems, validSourceMessage, true);
    if (validMessageId) {
      await store.updateMessage(validMessageId, {
        taskDraftProposal: {
          summary: `已保存 ${saved.todos.length} 个待办`,
          sourceMessage: validSourceMessage,
          needsConfirmation: false,
          items: validItems
        },
        taskDraftStatus: "accepted"
      });
    }
    broadcastSnapshotUpdated(_event.sender);
    return saved;
  });
  ipcMain.handle("todo:update", async (_event, id: unknown, patch: unknown) => {
    const validPatch = validateTodoPatch(patch);
    const updated = await store.updateTodo(validateStringId(id), validPatch);
    if ("title" in validPatch || "remindAt" in validPatch || "status" in validPatch) {
      await store.replaceReminderForTodo(updated.id, createReminder(updated));
      await refreshReminderTimers();
    }
    broadcastSnapshotUpdated(_event.sender);
    return updated;
  });
  ipcMain.handle("todo:delete", async (_event, id: unknown) => {
    const removed = await store.deleteTodo(validateStringId(id));
    await refreshReminderTimers();
    broadcastSnapshotUpdated(_event.sender);
    return removed;
  });
  ipcMain.handle("todo:undoLastAutoSave", async (_event) => {
    const removed = await store.undoLastAutoSave();
    if (removed) broadcastSnapshotUpdated(_event.sender);
    return removed;
  });

  ipcMain.handle("reminder:list", () => store.listReminders());
  ipcMain.handle("reminder:complete", async (_event, id: unknown) => completeReminder(validateStringId(id)));
  ipcMain.handle("reminder:dismiss", async (_event, id: unknown) => {
    const reminder = await store.updateReminder(validateStringId(id), { dismissedAt: new Date().toISOString() });
    await refreshReminderTimers();
    broadcastSnapshotUpdated(_event.sender);
    return reminder;
  });
  ipcMain.handle("reminder:snooze", async (_event, id: unknown, minutes: unknown) => snoozeReminder(validateStringId(id), validateSnoozeMinutes(minutes)));
  ipcMain.handle("reminder:test", async () => {
    const reminder: ReminderItem = {
      id: randomUUID(),
      title: "Neru 测试提醒",
      message: "如果你看到这条 Windows 通知，提醒功能可以正常触达。",
      remindAt: new Date().toISOString(),
      firedAt: new Date().toISOString()
    };
    await showReminder(reminder);
    return reminder;
  });

  ipcMain.handle("settings:get", () => store.getSettings());
  ipcMain.handle("settings:set", async (_event, patch: unknown) => {
    const validPatch = validateSettingsPatch(patch);
    const next = await store.updateSettings(validPatch);
    state.mainWindow?.setAlwaysOnTop(next.alwaysOnTop);
    app.setLoginItemSettings({ openAtLogin: next.launchAtLogin });
    if ("selectionToolsEnabled" in validPatch) await syncGlobalSelectionHook();
    if ("quickAiRecordShortcut" in validPatch) await registerQuickAiRecordShortcut();
    if ("language" in validPatch) await refreshTrayMenu();
    broadcastSnapshotUpdated(_event.sender);
    return next;
  });

  ipcMain.handle("appearance:selectFolder", async (_event) => selectPetAppearance(_event.sender));
  ipcMain.handle("appearance:reset", async (_event) => {
    const next = await store.updateSettings({ petAppearance: undefined });
    broadcastSnapshotUpdated(_event.sender);
    return next;
  });

  ipcMain.handle("summary:generate", async () => {
    const settings = await store.getSettings();
    const ai = resolveAiConfig(settings);
    const timeContext = getLocalTimeContext();
    const locale = resolveLocale(settings.language, app.getLocale());
    return summarizeRecentContext({
      ...ai,
      locale,
      messages: await store.listMessages(),
      todos: await store.listTodos(),
      ...timeContext
    });
  });

  ipcMain.handle("selection:process", async (_event, action: unknown, text: unknown, targetLanguage: unknown = "auto"): Promise<SelectionTextResult> => {
    const validAction = validateSelectionAction(action);
    const trimmed = validateSelectedText(text);
    const language = validateTargetLanguage(targetLanguage);
    const settings = await store.getSettings();
    const locale = resolveLocale(settings.language, app.getLocale());
    const result: SelectionTextResult = {
      id: randomUUID(),
      action: validAction,
      title: validAction === "summarize" ? translate(locale, "Neru 总结") : translate(locale, "Neru 翻译"),
      markdown: "",
      status: "pending",
      targetLanguage: validAction === "translate" ? language : undefined,
      createdAt: new Date().toISOString()
    };
    state.selectionResults.set(result.id, result);
    state.selectionResultSources.set(result.id, trimmed);
    await openSelectionResultWindow(result);
    void processSelectionResultInBackground(result, trimmed, validAction === "translate" ? language : undefined);
    return result;
  });
  ipcMain.handle("selection:retranslate", async (_event, id: unknown, targetLanguage: unknown): Promise<SelectionTextResult> => {
    const validId = validateStringId(id);
    const language = validateTargetLanguage(targetLanguage);
    const current = state.selectionResults.get(validId);
    const source = state.selectionResultSources.get(validId);
    if (!current || current.action !== "translate") throw new Error("Translation result not found");
    if (!source) throw new Error("Translation source text not found");
    const pending: SelectionTextResult = {
      ...current,
      markdown: "",
      status: "pending",
      error: undefined,
      targetLanguage: language,
      updatedAt: new Date().toISOString()
    };
    state.selectionResults.set(validId, pending);
    void processSelectionResultInBackground(pending, source, language);
    return pending;
  });
  ipcMain.handle("selection:getResult", (_event, id: unknown) => state.selectionResults.get(validateStringId(id)) ?? null);
  ipcMain.handle("selection:getCapture", (_event, id: unknown) => state.selectionCaptures.get(validateStringId(id)) ?? null);
  ipcMain.handle("selection:resolveCapture", (_event, id: unknown) => resolveSelectionCapture(validateStringId(id)));
  ipcMain.handle("selection:resizePopover", (_event, expanded: unknown, width?: unknown) => {
    const safeWidth = typeof width === "number" && Number.isFinite(width) ? width : undefined;
    resizeSelectionPopoverWindow(validateBoolean(expanded, "expanded"), safeWidth);
  });
  ipcMain.handle("selection:createTodoFromCapture", async (_event, id: unknown) => {
    const capture = await resolveSelectionCapture(validateStringId(id));
    await openWorkspaceWindow();
    state.workspaceWindow?.webContents.send("selection:todoText", capture.text);
    state.selectionPopoverWindow?.close();
  });
  ipcMain.handle("selection:addAskCapture", async (_event, id: unknown) => {
    const capture = await resolveSelectionCapture(validateStringId(id));
    state.selectionAskDraftCaptures.push(capture);
    return getSelectionAskDraft();
  });
  ipcMain.handle("selection:getAskDraft", (): ReturnType<typeof getSelectionAskDraft> => getSelectionAskDraft());
  ipcMain.handle("selection:clearAskDraft", () => {
    state.selectionAskDraftCaptures = [];
  });
  ipcMain.handle("selection:submitAskDraft", () => submitSelectionAskDraft());

  ipcMain.handle("codex:createSession", (_event, items: CodexDropItem[], options: unknown) => {
    return createCodexSession(items, validateCodexCreateOptions(options));
  });
  ipcMain.handle("codex:createSessionFromFolder", (_event, options: unknown) => {
    return createCodexSessionFromFolder(_event.sender, validateCodexCreateOptions(options));
  });
  ipcMain.handle("codex:listSavedSessions", () => listSavedCodexSessions());
  ipcMain.handle("codex:openSavedSession", (_event, savedSessionId: unknown, options: unknown) => {
    return openSavedCodexSession(validateStringId(savedSessionId, "savedSessionId"), validateCodexCreateOptions(options));
  });
  ipcMain.handle("codex:renameSavedSession", (_event, savedSessionId: unknown, name: unknown) => {
    return renameSavedCodexSession(validateStringId(savedSessionId, "savedSessionId"), validateSelectedText(name, "name"));
  });
  ipcMain.handle("codex:deleteSavedSession", (_event, savedSessionId: unknown) => {
    return deleteSavedCodexSession(validateStringId(savedSessionId, "savedSessionId"));
  });
  ipcMain.handle("codex:listModels", (_event, sessionId: unknown) => {
    return listCodexModels(validateCodexSessionId(sessionId));
  });
  ipcMain.handle("codex:listThreads", (_event, sessionId: unknown) => {
    return listCodexThreads(validateCodexSessionId(sessionId));
  });
  ipcMain.handle("codex:resumeThread", (_event, sessionId: unknown, threadId: unknown) => {
    return resumeCodexThread(validateCodexSessionId(sessionId), validateStringId(threadId, "threadId"));
  });
  ipcMain.handle("codex:newThread", (_event, sessionId: unknown) => {
    return newCodexThread(validateCodexSessionId(sessionId));
  });
  ipcMain.handle("codex:getSession", (_event, sessionId: unknown) => publicCodexSessionInfo(getCodexSession(validateCodexSessionId(sessionId))));
  ipcMain.handle("codex:startSession", (_event, sessionId: unknown, options: unknown) => {
    return startCodexSession(validateCodexSessionId(sessionId), validateCodexCreateOptions(options));
  });
  ipcMain.handle("codex:sendInput", async (_event, sessionId: unknown, text: unknown) => {
    const trimmed = validateChatMessage(text);
    if (!trimmed) return;
    await sendCodexInput(getCodexSession(validateCodexSessionId(sessionId)), trimmed);
  });
  ipcMain.handle("codex:setThreadSettings", (_event, sessionId: unknown, settings: unknown) => {
    return setCodexThreadSettings(validateCodexSessionId(sessionId), validateCodexThreadSettings(settings));
  });
  ipcMain.handle("codex:respondRequest", (_event, sessionId: unknown, requestId: unknown, response: unknown) => {
    if (typeof requestId !== "string" && typeof requestId !== "number") throw new Error("Invalid request id.");
    respondCodexRequest(validateCodexSessionId(sessionId), requestId, response);
  });
  ipcMain.handle("codex:updateSessionHistory", (_event, sessionId: unknown, history: CodexSessionHistory) => {
    updateCodexSessionHistory(validateCodexSessionId(sessionId), history);
  });
  ipcMain.handle("codex:write", (_event, sessionId: string, data: string) => {
    void sessionId;
    void data;
  });
  ipcMain.handle("codex:resize", (_event, sessionId: string, cols: number, rows: number) => {
    void sessionId;
    void cols;
    void rows;
  });
  ipcMain.handle("codex:stopSession", (_event, sessionId: unknown) => {
    const session = getCodexSession(validateCodexSessionId(sessionId));
    return stopCodexRuntimeSession(session).then(() => {
      broadcastCodexEvent(session.id, "status", { status: "stopped" });
    });
  });
  ipcMain.handle("codex:saveSession", (_event, sessionId: unknown) => saveCodexSession(validateCodexSessionId(sessionId)));
  ipcMain.handle("codex:discardSession", (_event, sessionId: unknown) => discardCodexSession(validateCodexSessionId(sessionId)));
  ipcMain.handle("codex:clearCache", () => clearClosedCodexTempSessions());
  ipcMain.handle("codex:openWorkspace", async (_event, sessionId: unknown) => {
    const session = getCodexSession(validateCodexSessionId(sessionId));
    if (!existsSync(session.workspacePath)) throw new Error("工作目录不存在。");
    await shell.openPath(session.workspacePath);
  });
}
