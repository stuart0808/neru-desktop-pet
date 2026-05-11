import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppSettings, DesktopPetApi, TodoItem } from "../shared/types.js";

const api: DesktopPetApi = {
  chat: {
    sendMessage: (text) => ipcRenderer.invoke("chat:sendMessage", text),
    listMessages: () => ipcRenderer.invoke("chat:listMessages"),
    updateTaskDraft: (messageId, patch) => ipcRenderer.invoke("chat:updateTaskDraft", messageId, patch),
    clearMessages: () => ipcRenderer.invoke("chat:clearMessages"),
    testApi: (apiKey) => ipcRenderer.invoke("chat:testApi", apiKey)
  },
  todo: {
    list: () => ipcRenderer.invoke("todo:list"),
    update: (id, patch) => ipcRenderer.invoke("todo:update", id, patch),
    delete: (id) => ipcRenderer.invoke("todo:delete", id),
    undoLastAutoSave: () => ipcRenderer.invoke("todo:undoLastAutoSave"),
    acceptPlanProposal: (items, sourceMessage, messageId) => ipcRenderer.invoke("todo:acceptPlanProposal", items, sourceMessage, messageId)
  },
  reminder: {
    list: () => ipcRenderer.invoke("reminder:list"),
    complete: (id) => ipcRenderer.invoke("reminder:complete", id),
    dismiss: (id) => ipcRenderer.invoke("reminder:dismiss", id),
    snooze: (id, minutes) => ipcRenderer.invoke("reminder:snooze", id, minutes),
    test: () => ipcRenderer.invoke("reminder:test")
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke("settings:set", patch)
  },
  appearance: {
    selectFolder: () => ipcRenderer.invoke("appearance:selectFolder"),
    reset: () => ipcRenderer.invoke("appearance:reset")
  },
  summary: {
    generate: () => ipcRenderer.invoke("summary:generate")
  },
  selection: {
    process: (action, text, targetLanguage) => ipcRenderer.invoke("selection:process", action, text, targetLanguage),
    retranslate: (id, targetLanguage) => ipcRenderer.invoke("selection:retranslate", id, targetLanguage),
    getResult: (id) => ipcRenderer.invoke("selection:getResult", id),
    getCapture: (id) => ipcRenderer.invoke("selection:getCapture", id),
    resolveCapture: (id) => ipcRenderer.invoke("selection:resolveCapture", id),
    resizePopover: (expanded, width) => ipcRenderer.invoke("selection:resizePopover", expanded, width),
    createTodoFromCapture: (id) => ipcRenderer.invoke("selection:createTodoFromCapture", id),
    addAskCapture: (id) => ipcRenderer.invoke("selection:addAskCapture", id),
    getAskDraft: () => ipcRenderer.invoke("selection:getAskDraft"),
    clearAskDraft: () => ipcRenderer.invoke("selection:clearAskDraft"),
    submitAskDraft: () => ipcRenderer.invoke("selection:submitAskDraft")
  },
  codex: {
    createSession: (items, options) => ipcRenderer.invoke("codex:createSession", items, options),
    createSessionFromFolder: (options) => ipcRenderer.invoke("codex:createSessionFromFolder", options),
    listSavedSessions: () => ipcRenderer.invoke("codex:listSavedSessions"),
    openSavedSession: (savedSessionId, options) => ipcRenderer.invoke("codex:openSavedSession", savedSessionId, options),
    renameSavedSession: (savedSessionId, name) => ipcRenderer.invoke("codex:renameSavedSession", savedSessionId, name),
    deleteSavedSession: (savedSessionId) => ipcRenderer.invoke("codex:deleteSavedSession", savedSessionId),
    listModels: (sessionId) => ipcRenderer.invoke("codex:listModels", sessionId),
    listThreads: (sessionId) => ipcRenderer.invoke("codex:listThreads", sessionId),
    resumeThread: (sessionId, threadId) => ipcRenderer.invoke("codex:resumeThread", sessionId, threadId),
    newThread: (sessionId) => ipcRenderer.invoke("codex:newThread", sessionId),
    getSession: (sessionId) => ipcRenderer.invoke("codex:getSession", sessionId),
    startSession: (sessionId, options) => ipcRenderer.invoke("codex:startSession", sessionId, options),
    sendInput: (sessionId, text) => ipcRenderer.invoke("codex:sendInput", sessionId, text),
    setThreadSettings: (sessionId, settings) => ipcRenderer.invoke("codex:setThreadSettings", sessionId, settings),
    respondRequest: (sessionId, requestId, response) => ipcRenderer.invoke("codex:respondRequest", sessionId, requestId, response),
    updateSessionHistory: (sessionId, history) => ipcRenderer.invoke("codex:updateSessionHistory", sessionId, history),
    write: (sessionId, data) => ipcRenderer.invoke("codex:write", sessionId, data),
    resize: (sessionId, cols, rows) => ipcRenderer.invoke("codex:resize", sessionId, cols, rows),
    stopSession: (sessionId) => ipcRenderer.invoke("codex:stopSession", sessionId),
    saveSession: (sessionId) => ipcRenderer.invoke("codex:saveSession", sessionId),
    discardSession: (sessionId) => ipcRenderer.invoke("codex:discardSession", sessionId),
    clearCache: () => ipcRenderer.invoke("codex:clearCache"),
    openWorkspace: (sessionId) => ipcRenderer.invoke("codex:openWorkspace", sessionId)
  },
  app: {
    snapshot: () => ipcRenderer.invoke("app:snapshot"),
    setIgnoreMouseEvents: (ignore) => ipcRenderer.invoke("app:setIgnoreMouseEvents", ignore),
    moveWindowBy: (deltaX, deltaY) => ipcRenderer.invoke("app:moveWindowBy", deltaX, deltaY),
    beginWindowDrag: () => ipcRenderer.invoke("app:beginWindowDrag"),
    dragWindowToCursor: () => {
      ipcRenderer.send("app:dragWindowToCursor");
      return Promise.resolve();
    },
    endWindowDrag: () => ipcRenderer.invoke("app:endWindowDrag"),
    setPetWindowExpanded: (expanded) => ipcRenderer.invoke("app:setPetWindowExpanded", expanded),
    openWorkspaceWindow: (todoId) => ipcRenderer.invoke("app:openWorkspaceWindow", todoId),
    checkForUpdates: () => ipcRenderer.invoke("app:checkForUpdates"),
    getPathForFile: (file) => webUtils.getPathForFile(file),
    openPath: (filePath) => ipcRenderer.invoke("app:openPath", filePath)
  },
  events: {
    onReminderFired: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, reminder: TodoItem) => callback(reminder as never);
      ipcRenderer.on("reminder:fired", listener);
      return () => ipcRenderer.removeListener("reminder:fired", listener);
    },
    onSnapshotUpdated: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("app:snapshotUpdated", listener);
      return () => ipcRenderer.removeListener("app:snapshotUpdated", listener);
    },
    onTodoFocus: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, todoId: string) => callback(todoId);
      ipcRenderer.on("todo:focus", listener);
      return () => ipcRenderer.removeListener("todo:focus", listener);
    },
    onSelectedTextTodo: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, text: string) => callback(text);
      ipcRenderer.on("selection:todoText", listener);
      return () => ipcRenderer.removeListener("selection:todoText", listener);
    },
    onQuickAiRecord: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("app:quickAiRecord", listener);
      return () => ipcRenderer.removeListener("app:quickAiRecord", listener);
    },
    onCodexOutput: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, output: unknown) => callback(output as never);
      ipcRenderer.on("codex:output", listener);
      return () => ipcRenderer.removeListener("codex:output", listener);
    },
    onCodexExit: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, exit: unknown) => callback(exit as never);
      ipcRenderer.on("codex:exit", listener);
      return () => ipcRenderer.removeListener("codex:exit", listener);
    },
    onCodexEvent: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, event: unknown) => callback(event as never);
      ipcRenderer.on("codex:event", listener);
      return () => ipcRenderer.removeListener("codex:event", listener);
    }
  }
};

contextBridge.exposeInMainWorld("desktopPet", api);
