import { app, BrowserWindow, dialog, shell, WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { spawn as spawnChild } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, extname, isAbsolute, join, sep } from "node:path";
import WebSocket from "ws";
import type { AppLocale, CodexApprovalPolicy, CodexClearCacheResult, CodexCopiedItem, CodexCreateSessionOptions, CodexDropItem, CodexPendingRequest, CodexReasoningEffort, CodexSandboxPolicy, CodexSavedSession, CodexSessionHistory, CodexSessionInfo, CodexStartOptions, CodexThreadMode, CodexThreadSettings, SelectionReference } from "../../shared/types.js";
import { resolveLocale, translate } from "../../shared/i18n.js";
import { state, type CodexRuntimeSession } from "./state.js";
import { JsonStore } from "./storage.js";
import { broadcastCodexEvent } from "./broadcast.js";
import { getPreloadPath, getRendererUrl, getAppIconPath, lockdownWindow } from "./windowUtils.js";
import { setCreateCodexSession } from "./selection.js";

const store = new JsonStore();

export function normalizeCodexSandbox(value: unknown): CodexSandboxPolicy {
  if (value === "read-only" || value === "danger-full-access") return value;
  return "workspace-write";
}

export function normalizeCodexApproval(value: unknown): CodexApprovalPolicy {
  return value === "never" ? "never" : "on-request";
}

function normalizeCodexExecutable(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed || "codex";
}

function prepareCodexSpawnCommand(executableSetting: string, args: string[]) {
  const commandParts = splitCommandLine(normalizeCodexExecutable(executableSetting));
  const executable = resolveExecutablePath(commandParts[0] || "codex");
  const allArgs = [...commandParts.slice(1), ...args];
  return { executable, args: allArgs };
}

function splitCommandLine(value: string): string[] {
  const matches = value.match(/"([^"]+)"|'([^']+)'|[^\s]+/g) ?? [];
  return matches.map((item) => item.replace(/^["']|["']$/g, ""));
}

function resolveExecutablePath(command: string): string {
  if (command.includes("\\") || command.includes("/") || isAbsolute(command)) {
    return resolveExecutableCandidate(command) ?? command;
  }
  const searchPaths = getExecutableSearchPaths();
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")
    : [""];
  for (const directory of searchPaths) {
    const found = resolveExecutableCandidate(join(directory, command), extensions);
    if (found) return found;
  }
  return command;
}

function resolveExecutableCandidate(candidate: string, extensions?: string[]): string | undefined {
  const candidates = extname(candidate)
    ? [candidate]
    : (extensions ?? ["", ".cmd", ".exe", ".bat", ".ps1"]).map((extension) => `${candidate}${extension}`);
  return candidates.find((item) => existsSync(item));
}

function getExecutableSearchPaths(): string[] {
  const paths = (process.env.PATH || "").split(delimiter).filter(Boolean);
  if (process.platform === "win32" && process.env.APPDATA) {
    paths.unshift(join(process.env.APPDATA, "npm"));
  }
  return Array.from(new Set(paths));
}

function getCodexTempRoot(): string {
  return join(tmpdir(), "neru-codex");
}

function sanitizeCodexDropItem(item: CodexDropItem): CodexDropItem | null {
  if (!item || typeof item.path !== "string") return null;
  const itemPath = item.path.trim();
  if (!itemPath) return null;
  return {
    path: itemPath,
    name: basename(itemPath),
    kind: item.kind === "directory" || item.kind === "file" ? item.kind : "unknown"
  };
}

export async function createCodexSession(items: CodexDropItem[], options: CodexCreateSessionOptions, openWindow = true, allowEmpty = false, draftPrompt = "", selectionReferences: SelectionReference[] = []): Promise<CodexSessionInfo> {
  const normalizedItems = items.map(sanitizeCodexDropItem).filter((item): item is CodexDropItem => Boolean(item));
  if (!normalizedItems.length && !allowEmpty) throw new Error("请先拖入至少一个文件或文件夹。");
  const sessionId = randomUUID();
  const rootPath = join(getCodexTempRoot(), sessionId);
  const workspacePath = join(rootPath, "workspace");
  await mkdir(workspacePath, { recursive: true });
  const usedNames = new Set<string>();
  const copiedItems: CodexCopiedItem[] = [];

  for (const item of normalizedItems) {
    const sourceStat = await stat(item.path).catch(() => null);
    if (!sourceStat) throw new Error(`找不到拖入项：${item.path}`);
    const kind = sourceStat.isDirectory() ? "directory" : sourceStat.isFile() ? "file" : "unknown";
    if (kind === "unknown") throw new Error(`暂不支持该类型：${item.path}`);
    const copiedName = getUniqueWorkspaceName(item.name || basename(item.path), usedNames);
    const copiedPath = join(workspacePath, copiedName);
    await cp(item.path, copiedPath, { recursive: kind === "directory", force: false, errorOnExist: true });
    copiedItems.push({ ...item, kind, copiedName, copiedPath });
  }

  const session: CodexRuntimeSession = {
    id: sessionId,
    rootPath,
    workspacePath,
    copiedItems,
    saved: false,
    createdAt: new Date().toISOString(),
    selectionReferences: sanitizeSelectionReferences(selectionReferences)
  };
  state.codexSessions.set(sessionId, session);
  if (openWindow) await openCodexWindow(session.id, options, draftPrompt);
  return publicCodexSessionInfo(session);
}

export async function createCodexSessionFromFolder(sender: WebContents, options: CodexCreateSessionOptions): Promise<CodexSessionInfo | null> {
  const owner = BrowserWindow.fromWebContents(sender) ?? state.workspaceWindow ?? state.mainWindow;
  const dialogOptions = { title: "选择要交给 Codex 的文件夹", properties: ["openDirectory"] as ("openDirectory")[] };
  const result = owner ? await dialog.showOpenDialog(owner, dialogOptions) : await dialog.showOpenDialog(dialogOptions);
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return null;
  const session = await createCodexSession([{ path: folder, name: basename(folder), kind: "directory" }], options, false);
  return saveCodexSession(session.id);
}

function getSavedCodexSessionsRoot(): string {
  return join(app.getPath("userData"), "codex-sessions");
}

export async function listSavedCodexSessions(): Promise<CodexSavedSession[]> {
  const root = getSavedCodexSessionsRoot();
  await mkdir(root, { recursive: true });
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const sessions: CodexSavedSession[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rootPath = join(root, entry.name);
    const metadata = await readCodexSavedMetadata(rootPath);
    sessions.push(metadata ?? {
      id: entry.name,
      name: entry.name,
      rootPath,
      workspacePath: join(rootPath, "workspace"),
      copiedItems: [],
      createdAt: entry.name.slice(0, 24)
    });
  }
  return sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function readCodexSavedMetadata(rootPath: string): Promise<CodexSavedSession | null> {
  try {
    const raw = await readFile(join(rootPath, "neru-codex-session.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<CodexSavedSession>;
    if (!parsed.id || !parsed.workspacePath) return null;
    return {
      id: parsed.id,
      name: parsed.name || parsed.id,
      rootPath,
      workspacePath: parsed.workspacePath,
      copiedItems: parsed.copiedItems ?? [],
      createdAt: parsed.createdAt || new Date().toISOString(),
      activeThreadId: parsed.activeThreadId,
      history: sanitizeCodexSessionHistory(parsed.history),
      threads: sanitizeCodexThreadHistories(parsed.threads),
      resumeStatus: sanitizeCodexResumeStatus(parsed.resumeStatus)
    };
  } catch {
    return null;
  }
}

function sanitizeCodexResumeStatus(value: unknown): CodexSessionInfo["resumeStatus"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<NonNullable<CodexSessionInfo["resumeStatus"]>>;
  if (input.status === "ready") return { status: "ready", threadId: typeof input.threadId === "string" ? input.threadId : undefined };
  if (input.status === "resumeFailed" && typeof input.threadId === "string") {
    return { status: "resumeFailed", threadId: input.threadId, message: typeof input.message === "string" ? input.message : "Codex thread resume failed" };
  }
  if (input.status === "localOnly") {
    return { status: "localOnly", threadId: typeof input.threadId === "string" ? input.threadId : undefined, message: typeof input.message === "string" ? input.message : "Only local history is available" };
  }
  return undefined;
}

function sanitizeCodexSessionHistory(value: unknown): CodexSessionHistory | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<CodexSessionHistory>;
  return {
    messages: Array.isArray(input.messages)
      ? input.messages
          .filter((item) => item && typeof item.id === "string" && typeof item.text === "string")
          .map((item) => ({
            id: item.id,
            role: item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : "system",
            text: item.role === "user" ? stripHiddenCodexPromptText(item.text) : item.text
          }))
      : [],
    activity: Array.isArray(input.activity)
      ? input.activity
          .filter((item) => item && typeof item.id === "string" && typeof item.title === "string" && typeof item.text === "string")
          .map((item) => ({
            id: item.id,
            type: typeof item.type === "string" ? item.type : "raw",
            title: item.title,
            text: item.text,
            status: typeof item.status === "string" ? item.status : undefined
          }))
      : [],
    settings: sanitizeCodexThreadSettings(input.settings)
  };
}

function sanitizeCodexThreadSettings(value: unknown): CodexThreadSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<CodexThreadSettings>;
  const settings: CodexThreadSettings = {};
  if (typeof input.model === "string" && input.model.trim()) settings.model = input.model.trim();
  const effort = normalizeCodexReasoningEffort(input.reasoningEffort);
  if (effort !== undefined) settings.reasoningEffort = effort;
  const mode = normalizeCodexThreadMode(input.mode);
  if (mode) settings.mode = mode;
  return Object.keys(settings).length ? settings : undefined;
}

function normalizeCodexReasoningEffort(value: unknown): CodexReasoningEffort | null | undefined {
  if (value === null) return null;
  if (value === "none" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") return value;
  return undefined;
}

function normalizeCodexThreadMode(value: unknown): CodexThreadMode | undefined {
  if (value === "plan") return "plan";
  if (value === "default") return "default";
  return undefined;
}

function sanitizeCodexThreadHistories(value: unknown): Record<string, CodexSessionHistory> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, CodexSessionHistory> = {};
  for (const [threadId, history] of Object.entries(value as Record<string, unknown>)) {
    const sanitized = sanitizeCodexSessionHistory(history);
    if (threadId && sanitized) result[threadId] = sanitized;
  }
  return result;
}

function sanitizeSelectionReferences(value: unknown): SelectionReference[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const input = item as Partial<SelectionReference>;
      const text = typeof input.text === "string" ? input.text.trim().slice(0, 8000) : "";
      if (!text) return null;
      return {
        id: typeof input.id === "string" && input.id.trim() ? input.id.trim() : randomUUID(),
        text,
        createdAt: typeof input.createdAt === "string" && input.createdAt.trim() ? input.createdAt.trim() : new Date().toISOString()
      };
    })
    .filter((item): item is SelectionReference => Boolean(item));
}

export async function openSavedCodexSession(savedSessionId: string, options: CodexCreateSessionOptions): Promise<CodexSessionInfo> {
  const saved = (await listSavedCodexSessions()).find((item) => item.id === savedSessionId);
  if (!saved) throw new Error("Saved Codex session not found");
  const existing = Array.from(state.codexSessions.values()).find((session) => session.savedPath === saved.rootPath || session.rootPath === saved.rootPath);
  if (existing) {
    existing.startOptions = {
      initialPrompt: "",
      sandbox: normalizeCodexSandbox(options.sandbox),
      approval: normalizeCodexApproval(options.approval)
    };
    return publicCodexSessionInfo(existing);
  }
  const sessionId = randomUUID();
  const session: CodexRuntimeSession = {
    id: sessionId,
    rootPath: saved.rootPath,
    workspacePath: saved.workspacePath,
    saved: true,
    savedPath: saved.rootPath,
    copiedItems: saved.copiedItems,
    createdAt: saved.createdAt,
    activeThreadId: saved.activeThreadId,
    threadId: saved.activeThreadId,
    history: getActiveCodexHistory(saved.activeThreadId, saved.threads, saved.history),
    threads: saved.threads,
    resumeStatus: saved.resumeStatus
  };
  state.codexSessions.set(sessionId, session);
  return publicCodexSessionInfo(session);
}

function getUniqueWorkspaceName(name: string, usedNames: Set<string>): string {
  const fallback = "item";
  const parsed = basename(name || fallback);
  const extension = extname(parsed);
  const stem = extension ? parsed.slice(0, -extension.length) : parsed;
  let candidate = parsed || fallback;
  let index = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = extension ? `${stem}-${index}${extension}` : `${stem}-${index}`;
    index += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

export function publicCodexSessionInfo(session: CodexRuntimeSession): CodexSessionInfo {
  return {
    id: session.id,
    workspacePath: session.workspacePath,
    saved: session.saved,
    savedPath: session.savedPath,
    copiedItems: session.copiedItems,
    createdAt: session.createdAt,
    activeThreadId: session.threadId ?? session.activeThreadId,
    history: getActiveCodexHistory(session.threadId ?? session.activeThreadId, session.threads, session.history),
    threads: session.threads,
    pendingRequests: getCodexPendingServerRequests(session),
    resumeStatus: session.resumeStatus,
    selectionReferences: session.selectionReferences
  };
}

function getActiveCodexHistory(threadId?: string, threads?: Record<string, CodexSessionHistory>, fallback?: CodexSessionHistory): CodexSessionHistory | undefined {
  return threadId && threads?.[threadId] ? threads[threadId] : fallback;
}

function getCodexPendingServerRequests(session: CodexRuntimeSession): CodexPendingRequest[] {
  return Array.from(session.pendingServerRequests?.values() ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function openCodexWindow(sessionId: string, options: CodexCreateSessionOptions, draftPrompt = ""): Promise<void> {
  const session = state.codexSessions.get(sessionId);
  if (!session) throw new Error("Codex session not found");
  let closeConfirmed = false;
  let discardOnClose = false;
  const codexWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 720,
    minHeight: 460,
    show: false,
    title: "Neru Codex",
    icon: getAppIconPath(),
    backgroundColor: "#eef7f2",
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });
  codexWindow.setMenuBarVisibility(false);
  lockdownWindow(codexWindow);
  codexWindow.once("ready-to-show", () => {
    codexWindow.show();
    codexWindow.focus();
  });
  codexWindow.on("close", (event) => {
    if (closeConfirmed || session.saved) return;
    event.preventDefault();
    void dialog.showMessageBox(codexWindow, {
      type: "question",
      title: "关闭 Codex 会话",
      message: "这个 Codex 会话还没有保存",
      detail: "关闭后可以保存到 Neru 会话目录，或丢弃临时副本。",
      buttons: ["保存并关闭", "丢弃", "取消"],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    }).then(async (result) => {
      if (result.response === 2 || codexWindow.isDestroyed()) return;
      if (result.response === 0) await saveCodexSession(session.id);
      else discardOnClose = true;
      closeConfirmed = true;
      codexWindow.close();
    });
  });
  codexWindow.on("closed", () => {
    void cleanupClosedCodexWindowSession(session, discardOnClose);
    state.codexSessions.delete(session.id);
  });
  await codexWindow.loadURL(
    getRendererUrl("codex") +
      `&id=${encodeURIComponent(sessionId)}` +
      `&prompt=${encodeURIComponent(options.initialPrompt ?? "")}` +
      `&draft=${encodeURIComponent(draftPrompt)}` +
      `&sandbox=${encodeURIComponent(options.sandbox)}` +
      `&approval=${encodeURIComponent(options.approval)}`
  );
}

export async function startCodexSession(sessionId: string, options: CodexStartOptions): Promise<void> {
  const session = state.codexSessions.get(sessionId);
  if (!session) throw new Error("Codex session not found");
  if (session.appSocket && session.threadId) return;
  session.startOptions = options;
  await ensureCodexAppSession(session);
  const prompt = (options.initialPrompt ?? "").trim();
  if (prompt) await sendCodexInput(session, prompt);
}

async function cleanupClosedCodexWindowSession(session: CodexRuntimeSession, discardOnClose: boolean): Promise<void> {
  if (discardOnClose) {
    await stopCodexRuntimeSession(session).catch(() => undefined);
  } else {
    if (session.appSocket) {
      session.appSocket.close();
      session.appSocket = undefined;
    }
    if (session.appServer) {
      session.appServer.kill();
      session.appServer = undefined;
    }
    session.appReady = undefined;
    session.threadId = undefined;
  }
  if (discardOnClose || !session.saved || session.savedPath !== session.rootPath) {
    await rm(session.rootPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function ensureCodexAppSession(session: CodexRuntimeSession): Promise<void> {
  if (session.appReady) return session.appReady;
  session.requestSeq = 1;
  session.pendingClientRequests = new Map();
  session.pendingServerRequests = new Map();
  session.appReady = new Promise<void>((resolve, reject) => {
    const command = prepareCodexAppServerSpawnCommand();
    let settled = false;
    const child = spawnChild(command.executable, command.args, {
      cwd: session.workspacePath,
      env: createCodexAppServerEnv()
    });
    session.appServer = child;
    let stderr = "";
    let connectionStarted = false;
    broadcastCodexEvent(session.id, "status", { status: "startingAppServer", command });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      broadcastCodexEvent(session.id, "raw", { stream: "stderr", text });
      const match = stripAnsi(stderr).match(/listening on:\s*(ws:\/\/[^\s]+)/);
      if (match && !connectionStarted) {
        connectionStarted = true;
        connectCodexAppSocket(session, match[1]).then(() => {
          settled = true;
          resolve();
        }, (error) => {
          settled = true;
          reject(error);
        });
      }
    });
    child.stdout.on("data", (chunk) => {
      broadcastCodexEvent(session.id, "raw", { stream: "stdout", text: chunk.toString() });
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      session.appServer = undefined;
      session.appSocket = undefined;
      broadcastCodexEvent(session.id, "status", { status: "exited", code, signal });
      if (!settled && !session.threadId) {
        settled = true;
        reject(new Error(`Codex 服务在初始化前退出（${code ?? signal ?? "unknown"}）。${stderr}`.trim()));
      }
    });
  });
  return session.appReady;
}

function createCodexAppServerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    MPLBACKEND: "Agg",
    PYTHONUNBUFFERED: "1"
  };
}

function stripAnsi(value: string): string {
  return value.replace(/\[[0-9;]*m/g, "");
}

function prepareCodexAppServerSpawnCommand() {
  const cliJs = join(process.env.APPDATA || "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");
  if (process.platform === "win32" && existsSync(cliJs)) {
    return {
      executable: resolveExecutablePath("node"),
      args: [cliJs, "app-server", "--listen", "ws://127.0.0.1:0"]
    };
  }
  return prepareCodexSpawnCommand("codex", ["app-server", "--listen", "ws://127.0.0.1:0"]);
}

function connectCodexAppSocket(session: CodexRuntimeSession, url: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(url);
    session.appSocket = ws;
    ws.on("open", async () => {
      try {
        broadcastCodexEvent(session.id, "status", { status: "connected", url });
        await codexRequest(session, "initialize", {
          clientInfo: { name: "Neru", version: app.getVersion() },
          capabilities: null
        });
        codexNotify(session, "initialized");
        const existingThreadId = session.activeThreadId ?? session.threadId;
        const hasExistingHistory = existingThreadId && !isEmptyCodexHistory(session.threads?.[existingThreadId] ?? session.history);
        let startResult: { thread?: { id?: string } };
        if (hasExistingHistory) {
          try {
            startResult = await codexRequest(session, "thread/resume", {
              threadId: existingThreadId,
              cwd: session.workspacePath,
              approvalPolicy: normalizeCodexApproval(session.startOptions?.approval),
              sandbox: normalizeCodexSandbox(session.startOptions?.sandbox),
              excludeTurns: false
            }) as { thread?: { id?: string } };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            session.threadId = undefined;
            session.activeThreadId = existingThreadId;
            session.resumeStatus = { status: "resumeFailed", threadId: existingThreadId, message };
            broadcastCodexEvent(session.id, "thread", { type: "threadResumeFailed", threadId: existingThreadId, message });
            if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
            resolve();
            return;
          }
        } else {
          startResult = await codexRequest(session, "thread/start", {
            cwd: session.workspacePath,
            approvalPolicy: normalizeCodexApproval(session.startOptions?.approval),
            sandbox: normalizeCodexSandbox(session.startOptions?.sandbox),
            sessionStartSource: "startup"
          }) as { thread?: { id?: string } };
        }
        const newThreadId = startResult.thread?.id;
        if (!newThreadId) throw new Error("Codex did not return a thread id");
        session.threads = session.threads ?? {};
        if (existingThreadId && existingThreadId !== newThreadId && session.threads[existingThreadId]) {
          session.threads[newThreadId] = session.threads[newThreadId] ?? session.threads[existingThreadId];
          delete session.threads[existingThreadId];
        }
        session.threadId = newThreadId;
        session.activeThreadId = session.threadId;
        session.resumeStatus = { status: "ready", threadId: session.threadId };
        session.threads[session.threadId] = session.threads[session.threadId] ?? { messages: [], activity: [] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resumedHistory = codexHistoryFromThread((startResult as any)?.thread);
        if (resumedHistory.messages.length || resumedHistory.activity.length) session.threads[session.threadId] = resumedHistory;
        session.history = session.threads[session.threadId];
        applyCodexThreadResponseSettings(session.history, startResult);
        broadcastCodexEvent(session.id, "thread", { ...startResult, threadId: session.threadId });
        resolve();
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Codex 服务初始化失败"));
      }
    });
    ws.on("message", (data) => handleCodexAppMessage(session, data.toString()));
    ws.on("error", (error) => {
      broadcastCodexEvent(session.id, "error", { message: error.message });
      reject(error);
    });
    ws.on("close", () => {
      session.appSocket = undefined;
      broadcastCodexEvent(session.id, "status", { status: "socketClosed" });
    });
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleCodexAppMessage(session: CodexRuntimeSession, text: string): void {
  let message: any;
  try {
    message = JSON.parse(text);
  } catch {
    broadcastCodexEvent(session.id, "raw", { text });
    return;
  }
  if ("id" in message && ("result" in message || "error" in message)) {
    const pending = session.pendingClientRequests?.get(message.id);
    if (pending) {
      session.pendingClientRequests?.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || "Codex request failed"));
      else pending.resolve(message.result);
    }
    return;
  }
  if ("id" in message && message.method) {
    rememberCodexPendingServerRequest(session, message);
    broadcastCodexEvent(session.id, "request", message);
    return;
  }
  if (message.method) {
    const kind = getCodexEventKind(message.method);
    if (message.method === "serverRequest/resolved") forgetCodexPendingServerRequest(session, message.params?.requestId ?? message.params?.id ?? message.id);
    captureCodexEventInSessionHistory(session, message);
    broadcastCodexEvent(session.id, kind, message);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rememberCodexPendingServerRequest(session: CodexRuntimeSession, message: any): void {
  session.pendingServerRequests = session.pendingServerRequests ?? new Map();
  const request: CodexPendingRequest = {
    id: message.id,
    method: String(message.method),
    params: message.params,
    threadId: typeof message.params?.threadId === "string" ? message.params.threadId : session.threadId ?? session.activeThreadId,
    createdAt: new Date().toISOString()
  };
  session.pendingServerRequests.set(String(message.id), request);
}

function forgetCodexPendingServerRequest(session: CodexRuntimeSession, requestId: unknown): void {
  if (requestId === undefined || requestId === null) return;
  session.pendingServerRequests?.delete(String(requestId));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function captureCodexEventInSessionHistory(session: CodexRuntimeSession, message: any): void {
  const threadId = message.params?.threadId;
  if (!threadId || typeof threadId !== "string") return;
  session.threads = session.threads ?? {};
  const history = session.threads[threadId] ?? { messages: [], activity: [] };
  session.threads[threadId] = history;
  const method = message.method;
  if (method === "item/started" || method === "item/completed") {
    const item = message.params?.item;
    if (!item?.id) return;
    if (item.type === "userMessage") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = stripHiddenCodexPromptText((item.content ?? []).map((part: any) => part.text).filter(Boolean).join("\n"));
      upsertCodexHistoryMessage(history, item.id, "user", text);
    } else if (item.type === "agentMessage") {
      upsertCodexHistoryMessage(history, item.id, "assistant", item.text ?? "");
    } else if (item.type === "commandExecution") {
      upsertCodexHistoryActivity(history, item.id, "command", `命令：${item.command ?? ""}`, item.aggregatedOutput ?? "", item.status);
    } else if (item.type === "fileChange") {
      upsertCodexHistoryActivity(history, item.id, "file", "文件变更", JSON.stringify(item.changes ?? [], null, 2), item.status);
    } else if (item.type === "plan") {
      upsertCodexHistoryActivity(history, item.id, "plan", "计划", item.text ?? "", method === "item/completed" ? "完成" : "更新中");
    } else if (item.type === "reasoning") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      upsertCodexHistoryActivity(history, item.id, "reasoning", "推理过程", [...(item.summary ?? []), ...(item.content ?? [])].map((s: any) => String(s)).join("\n"), method === "item/completed" ? "完成" : "思考中");
    }
  } else if (method === "item/agentMessage/delta") {
    appendCodexHistoryMessage(history, message.params.itemId, "assistant", message.params.delta ?? "");
  } else if (method === "item/commandExecution/outputDelta" || method === "command/exec/outputDelta") {
    appendCodexHistoryActivity(history, message.params.itemId ?? message.params.commandId ?? randomUUID(), "command", "命令输出", message.params.delta ?? "");
  } else if (method === "item/fileChange/patchUpdated") {
    upsertCodexHistoryActivity(history, message.params.itemId, "file", "文件变更", JSON.stringify(message.params.changes ?? [], null, 2), "待确认");
  }
  if (threadId === session.threadId) session.history = history;
  if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
}

function upsertCodexHistoryMessage(history: CodexSessionHistory, id: string, role: "user" | "assistant" | "system", text: string): void {
  const index = history.messages.findIndex((item) => item.id === id);
  if (index >= 0) history.messages[index] = { ...history.messages[index], role, text };
  else history.messages.push({ id, role, text });
}

function appendCodexHistoryMessage(history: CodexSessionHistory, id: string, role: "user" | "assistant" | "system", delta: string): void {
  const existing = history.messages.find((item) => item.id === id);
  if (existing) existing.text += delta;
  else history.messages.push({ id, role, text: delta });
}

function upsertCodexHistoryActivity(history: CodexSessionHistory, id: string, type: string, title: string, text: string, status?: string): void {
  const index = history.activity.findIndex((item) => item.id === id);
  if (index >= 0) history.activity[index] = { ...history.activity[index], type, title, text, status };
  else history.activity.push({ id, type, title, text, status });
}

function appendCodexHistoryActivity(history: CodexSessionHistory, id: string, type: string, title: string, delta: string): void {
  const existing = history.activity.find((item) => item.id === id);
  if (existing) existing.text += delta;
  else history.activity.push({ id, type, title, text: delta, status: "运行中" });
}

function getCodexEventKind(method: string): "status" | "thread" | "item" | "delta" | "requestResolved" | "error" | "raw" {
  if (method === "error") return "error";
  if (method.startsWith("thread/") || method.startsWith("turn/")) return "thread";
  if (method.includes("/delta") || method.includes("outputDelta") || method.includes("patchUpdated")) return "delta";
  if (method === "serverRequest/resolved") return "requestResolved";
  if (method.startsWith("item/") || method.startsWith("rawResponseItem/")) return "item";
  return "raw";
}

function codexRequest(session: CodexRuntimeSession, method: string, params: unknown): Promise<unknown> {
  if (!session.appSocket || session.appSocket.readyState !== WebSocket.OPEN) throw new Error("Codex 服务未连接");
  const id = session.requestSeq ?? 1;
  session.requestSeq = id + 1;
  const payload = { id, method, params };
  session.appSocket.send(JSON.stringify(payload));
  return new Promise<unknown>((resolve, reject) => {
    session.pendingClientRequests?.set(id, { resolve, reject });
    setTimeout(() => {
      if (!session.pendingClientRequests?.has(id)) return;
      session.pendingClientRequests.delete(id);
      reject(new Error(`Codex request timed out: ${method}`));
    }, 30_000);
  });
}

function codexNotify(session: CodexRuntimeSession, method: string, params?: unknown): void {
  if (!session.appSocket || session.appSocket.readyState !== WebSocket.OPEN) throw new Error("Codex 服务未连接");
  session.appSocket.send(JSON.stringify(params === undefined ? { method } : { method, params }));
}

export async function sendCodexInput(session: CodexRuntimeSession, text: string): Promise<void> {
  await ensureCodexAppSession(session);
  if (session.resumeStatus?.status === "resumeFailed") {
    throw new Error(`Codex 线程恢复失败，不能继续发送消息，以免对话记录和真实上下文不一致。请新建线程后继续。\n${session.resumeStatus.message}`);
  }
  if (!session.threadId) throw new Error("Codex thread is not ready");
  const sandbox = normalizeCodexSandbox(session.startOptions?.sandbox);
  const threadSettings = getActiveCodexThreadSettings(session);
  const references = sanitizeSelectionReferences(session.selectionReferences);
  const locale = resolveLocale((await store.getSettings()).language, app.getLocale());
  const inputText = references.length ? withSelectionReferences(text, references, locale) : text;
  const turnText = threadSettings.mode === "plan" ? withCodexPlanModeInstruction(inputText) : inputText;
  const params = {
    threadId: session.threadId,
    input: [{ type: "text", text: turnText, text_elements: [] }],
    cwd: session.workspacePath,
    approvalPolicy: normalizeCodexApproval(session.startOptions?.approval),
    sandboxPolicy: toCodexSandboxPolicy(sandbox, session.workspacePath),
    model: threadSettings.model || undefined,
    effort: threadSettings.reasoningEffort ?? undefined
  };
  try {
    await codexRequest(session, "turn/start", params);
    if (references.length) session.selectionReferences = [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("thread not found")) throw error;
    session.resumeStatus = { status: "resumeFailed", threadId: session.threadId, message };
    throw new Error(`Codex 没有找到该线程，已停止发送以避免上下文漂移。请新建线程后继续。\n${message}`);
  }
}

function withSelectionReferences(question: string, references: SelectionReference[], locale: AppLocale): string {
  const body = references
    .map((reference, index) => `[${translate(locale, "引用 {index}", { index: index + 1 })}]\n${reference.text.trim()}`)
    .join("\n\n");
  return `${translate(locale, "我想基于以下引用内容提问：")}\n\n${body}\n\n${translate(locale, "我的问题是：")}\n${question.trim()}`;
}

function getActiveCodexThreadSettings(session: CodexRuntimeSession): CodexThreadSettings {
  const history = getActiveCodexHistory(session.threadId ?? session.activeThreadId, session.threads, session.history);
  return history?.settings ?? {};
}

function withCodexPlanModeInstruction(text: string): string {
  return [
    "Plan mode is enabled for this thread. First produce a concise implementation plan and do not modify files or run mutating commands unless the user explicitly asks you to proceed.",
    "",
    text
  ].join("\n");
}

function stripCodexPlanModeInstruction(text: string): string {
  const prefix = "Plan mode is enabled for this thread. First produce a concise implementation plan and do not modify files or run mutating commands unless the user explicitly asks you to proceed.\n\n";
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

function stripSelectionAskPrompt(text: string): string {
  const locales: AppLocale[] = ["zh-CN", "en-US", "ja-JP", "ko-KR"];
  for (const locale of locales) {
    const prefix = `${translate(locale, "我想基于以下引用内容提问：")}\n\n`;
    const marker = `\n\n${translate(locale, "我的问题是：")}`;
    if (!text.startsWith(prefix)) continue;
    const index = text.lastIndexOf(marker);
    if (index < 0) return text;
    return text.slice(index + marker.length).trimStart();
  }
  return text;
}

function stripHiddenCodexPromptText(text: string): string {
  return stripSelectionAskPrompt(stripCodexPlanModeInstruction(text));
}

function toCodexSandboxPolicy(sandbox: CodexSandboxPolicy, workspacePath: string) {
  if (sandbox === "danger-full-access") return { type: "dangerFullAccess" };
  if (sandbox === "read-only") return { type: "readOnly", networkAccess: true };
  return {
    type: "workspaceWrite",
    writableRoots: [workspacePath],
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

export function respondCodexRequest(sessionId: string, requestId: number | string, response: unknown): void {
  const session = getCodexSession(sessionId);
  if (!session.appSocket || session.appSocket.readyState !== WebSocket.OPEN) throw new Error("Codex 服务未连接");
  session.appSocket.send(JSON.stringify({ id: requestId, result: response }));
  forgetCodexPendingServerRequest(session, requestId);
}

export async function listCodexModels(sessionId: string) {
  const session = getCodexSession(sessionId);
  await ensureCodexAppSession(session);
  const result = await codexRequest(session, "model/list", { includeHidden: true });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const models = Array.isArray((result as any)?.models) ? (result as any).models : Array.isArray(result) ? result : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return models.map((model: any) => ({
    id: String(model.id ?? model.slug ?? model.name ?? ""),
    displayName: typeof model.displayName === "string" ? model.displayName : typeof model.name === "string" ? model.name : undefined,
    hidden: Boolean(model.hidden),
    isDefault: Boolean(model.isDefault),
    defaultReasoningEffort: typeof model.defaultReasoningEffort === "string" ? model.defaultReasoningEffort : null,
    supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts)
      ? model.supportedReasoningEfforts
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => ({
            reasoningEffort: normalizeCodexReasoningEffort(item?.reasoningEffort),
            description: typeof item?.description === "string" ? item.description : undefined
          }))
          .filter((item: { reasoningEffort: CodexReasoningEffort | null | undefined }) => item.reasoningEffort && item.reasoningEffort !== null)
      : undefined,
    inputModalities: Array.isArray(model.inputModalities) ? model.inputModalities.map(String) : undefined,
    supportsPersonality: typeof model.supportsPersonality === "boolean" ? model.supportsPersonality : undefined
  })).filter((model: { id: string }) => model.id);
}

export function setCodexThreadSettings(sessionId: string, patch: Partial<CodexThreadSettings>): CodexSessionInfo {
  const session = getCodexSession(sessionId);
  const threadId = session.threadId ?? session.activeThreadId;
  if (!threadId) throw new Error("Codex thread is not ready");
  session.threads = session.threads ?? {};
  const history = session.threads[threadId] ?? session.history ?? { messages: [], activity: [] };
  session.threads[threadId] = history;
  session.history = history;
  const current = history.settings ?? {};
  const next: CodexThreadSettings = { ...current };
  if ("model" in patch) {
    const model = typeof patch.model === "string" ? patch.model.trim() : "";
    if (model) next.model = model;
    else delete next.model;
  }
  if ("reasoningEffort" in patch) {
    const effort = normalizeCodexReasoningEffort(patch.reasoningEffort);
    if (effort === undefined || effort === null) delete next.reasoningEffort;
    else next.reasoningEffort = effort;
  }
  if ("mode" in patch) {
    const mode = normalizeCodexThreadMode(patch.mode);
    if (mode && mode !== "default") next.mode = mode;
    else delete next.mode;
  }
  history.settings = Object.keys(next).length ? next : undefined;
  if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
  broadcastCodexEvent(session.id, "thread", { type: "threadSettings", threadId, settings: history.settings ?? {} });
  return publicCodexSessionInfo(session);
}

export async function listCodexThreads(sessionId: string) {
  const session = getCodexSession(sessionId);
  await ensureCodexAppSession(session);
  pruneEmptyInactiveCodexThreads(session);
  const now = Math.floor(Date.now() / 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merged = new Map<string, any>();
  for (const [threadId, history] of Object.entries(session.threads ?? {})) {
    if (isEmptyCodexHistory(history)) continue;
    const firstMessage = history.messages.find((message) => message.text.trim());
    merged.set(threadId, {
      id: threadId,
      preview: firstMessage?.text.slice(0, 120) || "空线程",
      name: threadId === session.threadId ? "当前线程" : null,
      path: null,
      cwd: session.workspacePath,
      source: "neru",
      status: threadId === session.threadId ? "active" : "saved",
      createdAt: now,
      updatedAt: now
    });
  }
  const result = await codexRequest(session, "thread/list", {
    limit: 50,
    cwd: session.workspacePath,
    archived: false
  }).catch(() => null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const threads = Array.isArray((result as any)?.data) ? (result as any).data : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const thread of threads) {
    const id = String(thread.id ?? "");
    if (!id) continue;
    const preview = String(thread.preview ?? "");
    const name = typeof thread.name === "string" ? thread.name : null;
    if (!preview.trim() && isEmptyCodexHistory(session.threads?.[id])) continue;
    if (id === session.threadId && isEmptyCodexHistory(session.threads?.[id])) continue;
    merged.set(id, {
      id,
      preview,
      name,
      path: typeof thread.path === "string" ? thread.path : null,
      cwd: String(thread.cwd ?? ""),
      source: typeof thread.source === "string" ? thread.source : JSON.stringify(thread.source ?? "unknown"),
      status: typeof thread.status === "string" ? thread.status : JSON.stringify(thread.status ?? "unknown"),
      createdAt: Number(thread.createdAt ?? now),
      updatedAt: Number(thread.updatedAt ?? now)
    });
  }
  return Array.from(merged.values()).sort((a, b) => Number(b.updatedAt ?? 0) - Number(a.updatedAt ?? 0));
}

export async function resumeCodexThread(sessionId: string, threadId: string): Promise<CodexSessionInfo> {
  const session = getCodexSession(sessionId);
  await ensureCodexAppSession(session);
  pruneEmptyInactiveCodexThreads(session, threadId);
  if (session.threadId === threadId && session.resumeStatus?.status !== "resumeFailed") {
    session.threadId = threadId;
    session.activeThreadId = threadId;
    session.history = getActiveCodexHistory(threadId, session.threads, session.history);
    if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
    return publicCodexSessionInfo(session);
  }
  let result: unknown;
  const targetSettings = session.threads?.[threadId]?.settings ?? {};
  try {
    result = await codexRequest(session, "thread/resume", {
      threadId,
      model: targetSettings.model || undefined,
      cwd: session.workspacePath,
      approvalPolicy: normalizeCodexApproval(session.startOptions?.approval),
      sandbox: normalizeCodexSandbox(session.startOptions?.sandbox),
      excludeTurns: false
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    session.threadId = undefined;
    session.activeThreadId = threadId;
    session.resumeStatus = { status: "resumeFailed", threadId, message: detail };
    if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
    throw new Error(`无法恢复线程 ${threadId}。它可能还没有被 Codex 保存，或已不在当前 Codex 服务中。\n${detail}`);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const thread = (result as any)?.thread ?? result;
  if (!thread?.id) throw new Error("Codex did not return a resumed thread");
  session.threadId = String(thread.id);
  session.activeThreadId = session.threadId;
  session.resumeStatus = { status: "ready", threadId: session.threadId };
  session.threads = session.threads ?? {};
  const resumedHistory = codexHistoryFromThread(thread);
  session.threads[session.threadId] = resumedHistory.messages.length || resumedHistory.activity.length
    ? resumedHistory
    : session.threads[session.threadId] ?? { messages: [], activity: [] };
  session.history = session.threads[session.threadId];
  applyCodexThreadResponseSettings(session.history, result);
  if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
  broadcastCodexEvent(session.id, "thread", { thread, threadId: session.threadId });
  return publicCodexSessionInfo(session);
}

export async function newCodexThread(sessionId: string): Promise<CodexSessionInfo> {
  const session = getCodexSession(sessionId);
  await ensureCodexAppSession(session);
  const currentThreadId = session.threadId ?? session.activeThreadId;
  if (currentThreadId && isEmptyCodexHistory(session.threads?.[currentThreadId] ?? session.history)) {
    return publicCodexSessionInfo(session);
  }
  const startResult = await codexRequest(session, "thread/start", {
    cwd: session.workspacePath,
    approvalPolicy: normalizeCodexApproval(session.startOptions?.approval),
    sandbox: normalizeCodexSandbox(session.startOptions?.sandbox),
    sessionStartSource: "startup"
  }) as { thread?: { id?: string } };
  const threadId = startResult.thread?.id;
  if (!threadId) throw new Error("Codex did not return a thread id");
  session.threadId = threadId;
  session.activeThreadId = threadId;
  session.resumeStatus = { status: "ready", threadId };
  session.threads = session.threads ?? {};
  session.threads[threadId] = { messages: [], activity: [] };
  session.history = session.threads[threadId];
  applyCodexThreadResponseSettings(session.history, startResult);
  if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
  broadcastCodexEvent(session.id, "thread", { ...startResult, threadId });
  return publicCodexSessionInfo(session);
}

function pruneEmptyInactiveCodexThreads(session: CodexRuntimeSession, keepThreadId?: string): void {
  const activeThreadId = keepThreadId ?? session.threadId ?? session.activeThreadId;
  if (!session.threads) return;
  for (const [threadId, history] of Object.entries(session.threads)) {
    if (threadId === activeThreadId) continue;
    if (isEmptyCodexHistory(history)) delete session.threads[threadId];
  }
  if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
}

function isEmptyCodexHistory(history?: CodexSessionHistory): boolean {
  return !history || (history.messages.length === 0 && history.activity.length === 0);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function codexHistoryFromThread(thread: any): CodexSessionHistory {
  const messages: CodexSessionHistory["messages"] = [];
  const activity: CodexSessionHistory["activity"] = [];
  for (const turn of Array.isArray(thread.turns) ? thread.turns : []) {
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (!item?.id) continue;
      if (item.type === "userMessage") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const text = stripHiddenCodexPromptText((item.content ?? []).map((part: any) => part.text).filter(Boolean).join("\n"));
        messages.push({ id: item.id, role: "user", text });
      } else if (item.type === "agentMessage") {
        messages.push({ id: item.id, role: "assistant", text: item.text ?? "" });
      } else if (item.type === "commandExecution") {
        activity.push({ id: item.id, type: "command", title: `命令：${item.command ?? ""}`, text: item.aggregatedOutput ?? "", status: item.status });
      } else if (item.type === "fileChange") {
        activity.push({ id: item.id, type: "file", title: "文件变更", text: JSON.stringify(item.changes ?? [], null, 2), status: item.status });
      } else if (item.type === "plan") {
        activity.push({ id: item.id, type: "plan", title: "计划", text: item.text ?? "", status: "完成" });
      } else if (item.type === "reasoning") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        activity.push({ id: item.id, type: "reasoning", title: "推理过程", text: [...(item.summary ?? []), ...(item.content ?? [])].map((s: any) => String(s)).join("\n"), status: "完成" });
      }
    }
  }
  return { messages, activity };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCodexThreadResponseSettings(history: CodexSessionHistory, response: unknown): void {
  const value = response as any;
  const model = typeof value?.model === "string" ? value.model : undefined;
  const effort = normalizeCodexReasoningEffort(value?.reasoningEffort);
  if (!model && effort === undefined) return;
  history.settings = {
    ...(history.settings ?? {}),
    ...(model ? { model } : {}),
    ...(effort !== undefined && effort !== null ? { reasoningEffort: effort } : {})
  };
}

export async function saveCodexSession(sessionId: string): Promise<CodexSessionInfo> {
  const session = state.codexSessions.get(sessionId);
  if (!session) throw new Error("Codex session not found");
  if (session.saved) {
    await writeCodexSavedMetadata(session);
    return publicCodexSessionInfo(session);
  }
  const sessionsRoot = join(app.getPath("userData"), "codex-sessions");
  await mkdir(sessionsRoot, { recursive: true });
  const targetPath = join(sessionsRoot, `${new Date().toISOString().replace(/[:.]/g, "-")}-${session.id}`);
  await cp(session.rootPath, targetPath, { recursive: true, force: false, errorOnExist: true });
  const metadata: CodexSavedSession = {
    id: basename(targetPath),
    name: session.copiedItems.length === 1 ? session.copiedItems[0].copiedName : `Codex 会话 ${new Date(session.createdAt).toLocaleString()}`,
    rootPath: targetPath,
    workspacePath: join(targetPath, "workspace"),
    copiedItems: session.copiedItems.map((item) => ({
      ...item,
      copiedPath: join(targetPath, "workspace", item.copiedName)
    })),
    createdAt: session.createdAt,
    activeThreadId: session.threadId ?? session.activeThreadId,
    history: getActiveCodexHistory(session.threadId ?? session.activeThreadId, session.threads, session.history),
    threads: session.threads,
    resumeStatus: session.resumeStatus
  };
  await writeFile(join(targetPath, "neru-codex-session.json"), JSON.stringify(metadata, null, 2), "utf8");
  session.saved = true;
  session.savedPath = targetPath;
  if (!session.appServer && !session.appSocket && !session.threadId) {
    const previousRoot = session.rootPath;
    session.rootPath = targetPath;
    session.workspacePath = metadata.workspacePath;
    session.copiedItems = metadata.copiedItems;
    await rm(previousRoot, { recursive: true, force: true });
  }
  return publicCodexSessionInfo(session);
}

export function updateCodexSessionHistory(sessionId: string, history: CodexSessionHistory): void {
  const session = getCodexSession(sessionId);
  const sanitized = sanitizeCodexSessionHistory(history);
  const threadId = session.threadId ?? session.activeThreadId;
  const existingSettings = threadId ? session.threads?.[threadId]?.settings ?? session.history?.settings : session.history?.settings;
  if (sanitized && !sanitized.settings && existingSettings) sanitized.settings = existingSettings;
  session.history = sanitized;
  if (threadId && sanitized) {
    session.activeThreadId = threadId;
    session.threads = session.threads ?? {};
    session.threads[threadId] = sanitized;
  }
  if (session.saved) void writeCodexSavedMetadata(session).catch(() => undefined);
}

async function writeCodexSavedMetadata(session: CodexRuntimeSession): Promise<void> {
  const rootPath = session.savedPath ?? session.rootPath;
  const workspacePath = join(rootPath, "workspace");
  const metadata: CodexSavedSession = {
    id: basename(rootPath),
    name: await getCodexSavedSessionName(rootPath, session),
    rootPath,
    workspacePath,
    copiedItems: session.copiedItems.map((item) => ({
      ...item,
      copiedPath: join(workspacePath, item.copiedName)
    })),
    createdAt: session.createdAt,
    activeThreadId: session.threadId ?? session.activeThreadId,
    history: getActiveCodexHistory(session.threadId ?? session.activeThreadId, session.threads, session.history),
    threads: session.threads,
    resumeStatus: session.resumeStatus
  };
  await writeFile(join(rootPath, "neru-codex-session.json"), JSON.stringify(metadata, null, 2), "utf8");
}

async function getCodexSavedSessionName(rootPath: string, session: CodexRuntimeSession): Promise<string> {
  const existing = await readCodexSavedMetadata(rootPath);
  if (existing?.name) return existing.name;
  return session.copiedItems.length === 1 ? session.copiedItems[0].copiedName : `Codex 会话 ${new Date(session.createdAt).toLocaleString()}`;
}

export async function renameSavedCodexSession(savedSessionId: string, name: string): Promise<CodexSavedSession> {
  const saved = (await listSavedCodexSessions()).find((item) => item.id === savedSessionId);
  if (!saved) throw new Error("Saved Codex session not found");
  const nextName = name.trim();
  if (!nextName) throw new Error("会话名称不能为空。");
  const metadata: CodexSavedSession = { ...saved, name: nextName };
  await writeFile(join(saved.rootPath, "neru-codex-session.json"), JSON.stringify(metadata, null, 2), "utf8");
  for (const session of state.codexSessions.values()) {
    if (session.savedPath === saved.rootPath || session.rootPath === saved.rootPath) {
      session.history = metadata.history;
      session.threads = metadata.threads;
      session.activeThreadId = metadata.activeThreadId;
    }
  }
  return metadata;
}

export async function deleteSavedCodexSession(savedSessionId: string): Promise<void> {
  const saved = (await listSavedCodexSessions()).find((item) => item.id === savedSessionId);
  if (!saved) return;
  for (const [sessionId, session] of state.codexSessions.entries()) {
    if (session.savedPath !== saved.rootPath && session.rootPath !== saved.rootPath) continue;
    await stopCodexRuntimeSession(session);
    state.codexSessions.delete(sessionId);
  }
  await removeCodexDirectory(saved.rootPath);
}

export async function discardCodexSession(sessionId: string): Promise<void> {
  const session = state.codexSessions.get(sessionId);
  if (!session) return;
  await stopCodexRuntimeSession(session);
  await removeCodexDirectory(session.rootPath);
  state.codexSessions.delete(sessionId);
}

export async function clearClosedCodexTempSessions(): Promise<CodexClearCacheResult> {
  const root = getCodexTempRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const activeRoots = getActiveCodexCacheRoots();
  let deletedCount = 0;
  let skippedCount = 0;
  let freedBytes = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const targetPath = join(root, entry.name);
    if (!isPathInsideDirectory(targetPath, root)) continue;
    if (activeRoots.has(normalizeCachePath(targetPath))) {
      skippedCount += 1;
      continue;
    }
    const size = await getDirectorySize(targetPath);
    await removeCodexDirectory(targetPath);
    deletedCount += 1;
    freedBytes += size;
  }

  return { deletedCount, skippedCount, freedBytes };
}

function getActiveCodexCacheRoots(): Set<string> {
  const root = getCodexTempRoot();
  const activeRoots = new Set<string>();
  for (const session of state.codexSessions.values()) {
    for (const candidate of [session.rootPath, session.savedPath]) {
      if (candidate && isPathInsideDirectory(candidate, root)) activeRoots.add(normalizeCachePath(candidate));
    }
  }
  return activeRoots;
}

function isPathInsideDirectory(targetPath: string, directoryPath: string): boolean {
  const target = normalizeCachePath(targetPath);
  const directory = normalizeCachePath(directoryPath);
  return target === directory || target.startsWith(`${directory}${sep}`);
}

function normalizeCachePath(value: string): string {
  const normalized = value.replace(/[\\/]+$/g, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function getDirectorySize(targetPath: string): Promise<number> {
  const entries = await readdir(targetPath, { withFileTypes: true }).catch(() => []);
  let total = 0;
  for (const entry of entries) {
    const itemPath = join(targetPath, entry.name);
    if (entry.isDirectory()) total += await getDirectorySize(itemPath);
    else if (entry.isFile()) total += (await stat(itemPath).catch(() => null))?.size ?? 0;
  }
  return total;
}

export async function stopCodexRuntimeSession(session: CodexRuntimeSession): Promise<void> {
  if (session.appSocket) {
    const socket = session.appSocket;
    const closed = new Promise<void>((resolve) => {
      socket.once("close", () => resolve());
      socket.once("error", () => resolve());
    });
    session.appSocket.close();
    await Promise.race([closed, delay(600)]);
    session.appSocket = undefined;
  }
  if (session.appServer) {
    const appServer = session.appServer;
    const exited = new Promise<void>((resolve) => {
      appServer.once("exit", () => resolve());
      appServer.once("close", () => resolve());
    });
    session.appServer.kill();
    await Promise.race([exited, delay(1800)]);
    session.appServer = undefined;
  }
  session.appReady = undefined;
  session.threadId = undefined;
  session.pendingClientRequests?.clear();
  session.pendingServerRequests?.clear();
}

async function removeCodexDirectory(targetPath: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(targetPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 120 });
      return;
    } catch (error) {
      lastError = error;
      await delay(180 + attempt * 180);
    }
  }
  const message = lastError instanceof Error ? lastError.message : "unknown error";
  throw new Error(`删除目录失败，可能仍被 Codex 或资源管理器占用：${targetPath}\n${message}`);
}

export function getCodexSession(sessionId: string): CodexRuntimeSession {
  const session = state.codexSessions.get(sessionId);
  if (!session) throw new Error("Codex session not found");
  return session;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

setCreateCodexSession(createCodexSession);
