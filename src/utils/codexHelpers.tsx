import React from "react";
import type {
  AppLocale,
  CodexApprovalPolicy,
  CodexDropItem,
  CodexModelSummary,
  CodexPendingRequest,
  CodexReasoningEffort,
  CodexSandboxPolicy,
  CodexSessionInfo,
  CodexThreadSettings,
  CodexUiActivity,
  CodexUiMessage,
  DesktopPetApi
} from "../../shared/types";
import { translate } from "../../shared/i18n";
import { codexSlashCommands } from "./constants";

export type CodexInputSuggestion = {
  value: string;
  label: string;
  description?: string;
};

export type CodexMarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; items: string[] }
  | { type: "quote"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "code"; text: string; language?: string };

export function normalizeCodexSandbox(value: string | null | undefined): CodexSandboxPolicy {
  if (value === "read-only" || value === "danger-full-access") return value;
  return "workspace-write";
}

export function normalizeCodexApproval(value: string | null | undefined): CodexApprovalPolicy {
  return value === "never" ? "never" : "on-request";
}

export function getCodexSandboxLabel(value: CodexSandboxPolicy): string {
  if (value === "read-only") return "只读分析";
  if (value === "danger-full-access") return "完全权限";
  return "允许修改副本";
}

export function getCodexApprovalLabel(value: CodexApprovalPolicy): string {
  return value === "never" ? "不询问" : "需要时询问";
}

export function hasFileDrop(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

export function getDropItems(dataTransfer: DataTransfer, api?: DesktopPetApi): CodexDropItem[] {
  return Array.from(dataTransfer.files)
    .map<CodexDropItem | null>((file) => {
      const path = api?.app.getPathForFile(file) || (file as File & { path?: string }).path;
      if (!path) return null;
      return {
        path,
        name: file.name || path.split(/[\\/]/).pop() || path,
        kind: "unknown" as const
      };
    })
    .filter((item): item is CodexDropItem => item !== null);
}

export function dedupeCodexItems(items: CodexDropItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.path.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getCodexActiveThreadSettings(session: CodexSessionInfo | null): CodexThreadSettings {
  if (!session) return {};
  const threadId = session.activeThreadId;
  return (threadId ? session.threads?.[threadId]?.settings : undefined) ?? session.history?.settings ?? {};
}

export function applyCodexThreadEventToSession(session: CodexSessionInfo, payload: unknown, threadId: string): CodexSessionInfo {
  const value = payload as any;
  if (value?.type === "threadResumeFailed") {
    return {
      ...session,
      activeThreadId: threadId,
      resumeStatus: {
        status: "resumeFailed",
        threadId,
        message: typeof value.message === "string" ? value.message : "Codex thread resume failed"
      }
    };
  }
  if (value?.type !== "threadSettings") return { ...session, activeThreadId: threadId };
  const settings = sanitizeClientCodexThreadSettings(value.settings);
  const threads = { ...(session.threads ?? {}) };
  const history = threads[threadId] ?? session.history ?? { messages: [], activity: [] };
  threads[threadId] = { ...history, settings };
  return {
    ...session,
    activeThreadId: threadId,
    history: threadId === session.activeThreadId || !session.activeThreadId ? threads[threadId] : session.history,
    threads
  };
}

export function sanitizeClientCodexThreadSettings(value: unknown): CodexThreadSettings | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Partial<CodexThreadSettings>;
  const settings: CodexThreadSettings = {};
  if (typeof input.model === "string" && input.model.trim()) settings.model = input.model.trim();
  if (isCodexReasoningEffort(input.reasoningEffort)) settings.reasoningEffort = input.reasoningEffort;
  if (input.mode === "plan") settings.mode = "plan";
  return Object.keys(settings).length ? settings : undefined;
}

export async function handleLocalCodexCommand({
  api,
  session,
  text,
  models,
  setSession,
  setStatusText
}: {
  api: DesktopPetApi;
  session: CodexSessionInfo | null;
  text: string;
  models: CodexModelSummary[];
  setSession(session: CodexSessionInfo): void;
  setStatusText: React.Dispatch<React.SetStateAction<string>>;
}) {
  if (!session) return false;
  const [command, ...parts] = text.split(/\s+/);
  if (command === "/model") {
    if (!parts.length) {
      setStatusText("请选择模型，或输入 /model <model> [effort]");
      return true;
    }
    const model = parts[0];
    const effort = parts.find(isCodexReasoningEffort);
    const selected = models.find((item) => item.id === model || item.displayName === model);
    const next = await api.codex.setThreadSettings(session.id, {
      model: selected?.id ?? model,
      ...(effort ? { reasoningEffort: effort } : {})
    });
    setSession(next);
    setStatusText(`当前线程已切换到 ${getCodexModelLabel(selected?.id ?? model, models)}${effort ? ` / ${effort}` : ""}`);
    return true;
  }
  if (command === "/plan") {
    const current = getCodexActiveThreadSettings(session);
    const explicit = parts[0]?.toLowerCase();
    const mode = explicit === "off" || explicit === "default" || explicit === "false"
      ? "default"
      : current.mode === "plan" && (explicit === "toggle" || !explicit)
        ? "default"
        : "plan";
    const next = await api.codex.setThreadSettings(session.id, { mode });
    setSession(next);
    setStatusText(mode === "plan" ? "当前线程已进入计划模式" : "当前线程已退出计划模式");
    return true;
  }
  return false;
}

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return value === "none" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

export function getCodexModelLabel(modelId: string, models: CodexModelSummary[]) {
  const model = models.find((item) => item.id === modelId);
  return model?.displayName ? `${model.displayName}` : modelId;
}

export function rememberCodexInput(text: string, setHistory: React.Dispatch<React.SetStateAction<string[]>>) {
  setHistory((current) => {
    const deduped = current.filter((item) => item !== text);
    return [...deduped, text].slice(-80);
  });
}

export function getNextCodexInputHistory(history: string[], currentIndex: number | null, direction: -1 | 1) {
  if (!history.length) return null;
  if (currentIndex === null) {
    if (direction === 1) return null;
    const index = direction === -1 ? history.length - 1 : 0;
    return { index, value: history[index] };
  }
  if (direction === 1 && currentIndex >= history.length - 1) {
    return { index: null, value: "" };
  }
  const index = Math.min(history.length - 1, Math.max(0, currentIndex + direction));
  return { index, value: history[index] };
}

export function stripCodexPlanModeInstruction(text: string) {
  const prefix = "Plan mode is enabled for this thread. First produce a concise implementation plan and do not modify files or run mutating commands unless the user explicitly asks you to proceed.\n\n";
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

export function stripSelectionAskPrompt(text: string) {
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

export function stripHiddenCodexPromptText(text: string) {
  return stripSelectionAskPrompt(stripCodexPlanModeInstruction(text));
}

export function getCodexEventThreadId(payload: unknown) {
  const value = payload as any;
  if (typeof value?.params?.threadId === "string") return value.params.threadId;
  if (typeof value?.threadId === "string") return value.threadId;
  if (typeof value?.thread?.id === "string") return value.thread.id;
  return undefined;
}

export function upsertCodexMessage(setter: React.Dispatch<React.SetStateAction<CodexUiMessage[]>>, id: string, role: "user" | "assistant" | "system", text: string) {
  setter((current) => current.some((item) => item.id === id)
    ? current.map((item) => item.id === id ? { ...item, role, text } : item)
    : [...current, { id, role, text }]);
}

export function appendCodexMessage(setter: React.Dispatch<React.SetStateAction<CodexUiMessage[]>>, id: string, role: "user" | "assistant" | "system", delta: string) {
  setter((current) => current.some((item) => item.id === id)
    ? current.map((item) => item.id === id ? { ...item, text: item.text + delta } : item)
    : [...current, { id, role, text: delta }]);
}

export function upsertCodexActivity(setter: React.Dispatch<React.SetStateAction<CodexUiActivity[]>>, id: string, type: string, title: string, text: string, status?: string) {
  setter((current) => current.some((item) => item.id === id)
    ? current.map((item) => item.id === id ? { ...item, type, title, text, status } : item)
    : [...current, { id, type, title, text, status }]);
}

export function appendCodexActivity(setter: React.Dispatch<React.SetStateAction<CodexUiActivity[]>>, id: string, type: string, title: string, delta: string) {
  setter((current) => current.some((item) => item.id === id)
    ? current.map((item) => item.id === id ? { ...item, text: item.text + delta } : item)
    : [...current, { id, type, title, text: delta, status: "运行中" }]);
}

export function applyCodexUiEvent(
  kind: string,
  payload: any,
  state: {
    setMessages: React.Dispatch<React.SetStateAction<CodexUiMessage[]>>;
    setActivity: React.Dispatch<React.SetStateAction<CodexUiActivity[]>>;
    setRequests: React.Dispatch<React.SetStateAction<CodexPendingRequest[]>>;
    setRawEvents: React.Dispatch<React.SetStateAction<string[]>>;
    setStatus: React.Dispatch<React.SetStateAction<"starting" | "running" | "exited" | "error">>;
    setStatusText: React.Dispatch<React.SetStateAction<string>>;
    setResponding: React.Dispatch<React.SetStateAction<boolean>>;
  }
) {
  const method = payload?.method;
  state.setRawEvents((current) => [...current.slice(-80), JSON.stringify(payload)]);
  if (kind === "request") {
    state.setResponding(false);
    state.setRequests((current) => {
      const nextRequest: CodexPendingRequest = {
        id: payload.id,
        method,
        params: payload.params,
        threadId: typeof payload.params?.threadId === "string" ? payload.params.threadId : undefined,
        createdAt: new Date().toISOString()
      };
      return current.some((request) => request.id === payload.id)
        ? current.map((request) => request.id === payload.id ? nextRequest : request)
        : [...current, nextRequest];
    });
    return;
  }
  if (kind === "requestResolved" || method === "serverRequest/resolved") {
    const requestId = payload?.params?.requestId ?? payload?.params?.id ?? payload?.id;
    if (requestId !== undefined) {
      state.setRequests((current) => current.filter((request) => request.id !== requestId));
    }
    return;
  }
  if (kind === "error") {
    state.setStatus("error");
    state.setStatusText(payload?.params?.message ?? payload?.message ?? "Codex 出错");
    state.setResponding(false);
    return;
  }
  if (method === "thread/status/changed") {
    const status = payload.params?.status?.type ?? "running";
    state.setStatus(status === "idle" ? "running" : "running");
    state.setStatusText(status === "idle" ? "Codex 空闲" : "Codex 正在处理");
    state.setResponding(status !== "idle");
    return;
  }
  if (kind === "thread") {
    if (payload?.type === "threadResumeFailed") {
      state.setStatus("error");
      state.setStatusText(`线程恢复失败：${payload.message ?? "Codex 无法恢复该线程"}`);
      state.setResponding(false);
      return;
    }
    state.setStatus("running");
    state.setStatusText("Codex 已连接");
    return;
  }
  if (kind === "status") {
    const status = payload?.status;
    if (status === "startingAppServer") state.setStatusText("正在启动 Codex 服务...");
    else if (status === "connected") state.setStatusText("正在连接 Codex...");
    else if (status === "socketClosed") {
      state.setStatus("exited");
      state.setStatusText("Codex 连接已关闭");
      state.setResponding(false);
      state.setRequests([]);
    } else if (status === "stopped") {
      state.setStatus("exited");
      state.setStatusText("Codex 已停止");
      state.setResponding(false);
      state.setRequests([]);
    } else if (status === "exited") {
      state.setStatus("exited");
      state.setStatusText("Codex 服务已退出");
      state.setResponding(false);
      state.setRequests([]);
    }
    return;
  }
  if (method === "item/started" || method === "item/completed") {
    const item = payload.params?.item;
    if (!item?.id) return;
    if (method === "item/started" && item.type !== "userMessage") state.setResponding(true);
    if (item.type === "userMessage") {
      const text = stripHiddenCodexPromptText((item.content ?? []).map((part: any) => part.text).filter(Boolean).join("\n"));
      upsertCodexMessage(state.setMessages, item.id, "user", text);
    } else if (item.type === "agentMessage") {
      upsertCodexMessage(state.setMessages, item.id, "assistant", item.text ?? "");
    } else if (item.type === "commandExecution") {
      upsertCodexActivity(state.setActivity, item.id, "command", `命令：${item.command}`, item.aggregatedOutput ?? "", item.status);
    } else if (item.type === "fileChange") {
      upsertCodexActivity(state.setActivity, item.id, "file", "文件变更", JSON.stringify(item.changes ?? [], null, 2), item.status);
    } else if (item.type === "plan") {
      upsertCodexActivity(state.setActivity, item.id, "plan", "计划", item.text ?? "", method === "item/completed" ? "完成" : "更新中");
    } else if (item.type === "reasoning") {
      const text = [...(item.summary ?? []), ...(item.content ?? [])].join("\n");
      upsertCodexActivity(state.setActivity, item.id, "reasoning", "推理过程", text, method === "item/completed" ? "完成" : "思考中");
    } else {
      upsertCodexActivity(state.setActivity, item.id, item.type, item.type, JSON.stringify(item, null, 2), method === "item/completed" ? "完成" : "进行中");
    }
    return;
  }
  if (method === "item/agentMessage/delta") {
    state.setResponding(true);
    appendCodexMessage(state.setMessages, payload.params.itemId, "assistant", payload.params.delta ?? "");
  } else if (method === "item/commandExecution/outputDelta" || method === "command/exec/outputDelta") {
    state.setResponding(true);
    appendCodexActivity(state.setActivity, payload.params.itemId ?? payload.params.commandId ?? crypto.randomUUID(), "command", "命令输出", payload.params.delta ?? "");
  } else if (method === "item/fileChange/patchUpdated") {
    state.setResponding(true);
    upsertCodexActivity(state.setActivity, payload.params.itemId, "file", "文件变更", JSON.stringify(payload.params.changes ?? [], null, 2), "待确认");
  } else if (method === "turn/completed") {
    state.setStatusText("Codex 空闲");
    state.setResponding(false);
  } else if (method === "turn/interrupt" || method === "turn/interrupted") {
    state.setStatusText("Codex 已中断");
    state.setResponding(false);
    state.setRequests([]);
  }
}

export function getCodexInputSuggestions(input: string, session: CodexSessionInfo | null, models: CodexModelSummary[]): CodexInputSuggestion[] {
  if (input.startsWith("/")) {
    const normalized = input.toLowerCase();
    const commandSuggestions = codexSlashCommands
      .filter((command) => command.command.startsWith(normalized))
      .map((command) => ({
        value: command.command,
        label: command.command,
        description: command.description
      }));
    if (normalized.startsWith("/model")) {
      const modelPrefix = input.slice("/model".length).trim().toLowerCase();
      const matchingModels = models
        .filter((model) => !model.hidden)
        .filter((model) => {
          const modelName = model.displayName ?? "";
          return model.id.toLowerCase().includes(modelPrefix) || modelName.toLowerCase().includes(modelPrefix);
        })
        .slice(0, 8);
      const modelSuggestions = matchingModels.map((model) => ({
        value: `/model ${model.id}${model.defaultReasoningEffort ? ` ${model.defaultReasoningEffort}` : ""}`,
        label: model.displayName ? `${model.displayName} (${model.id})` : model.id,
        description: model.isDefault ? "默认模型" : model.defaultReasoningEffort ? `默认推理强度: ${model.defaultReasoningEffort}` : "模型"
      }));
      return [...modelSuggestions, ...commandSuggestions].slice(0, 8);
    }
    return commandSuggestions.slice(0, 8);
  }
  if (input.includes("@")) {
    const prefix = input.slice(input.lastIndexOf("@") + 1).toLowerCase();
    return (session?.copiedItems ?? [])
      .map((item) => ({
        value: `${input.slice(0, input.lastIndexOf("@"))}@${item.copiedName}`,
        label: item.copiedName,
        description: item.path
      }))
      .filter((item) => item.value.toLowerCase().includes(prefix))
      .slice(0, 6);
  }
  return [];
}

export function parseMarkdownBlocks(text: string): CodexMarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: CodexMarkdownBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  }

  function flushList() {
    if (list.length) {
      blocks.push({ type: "list", items: list });
      list = [];
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      const language = line.slice(3).trim() || undefined;
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "code", text: codeLines.join("\n"), language });
      i++;
      continue;
    }
    if (line.startsWith("> ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: line.slice(2) });
      i++;
      continue;
    }
    if (line.match(/^[-*]\s+/) || line.match(/^\d+\.\s+/)) {
      flushParagraph();
      list.push(line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""));
      i++;
      continue;
    }
    if (isMarkdownTableLine(line)) {
      flushParagraph();
      flushList();
      const rows: string[][] = [];
      while (i < lines.length && isMarkdownTableLine(lines[i])) {
        const row = parseMarkdownTableRow(lines[i]);
        if (!isMarkdownTableSeparator(row)) rows.push(row);
        i++;
      }
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    if (line.trim() === "") {
      flushList();
      if (paragraph.length) {
        flushParagraph();
      }
      i++;
      continue;
    }
    if (list.length) flushList();
    paragraph.push(line);
    i++;
  }
  flushParagraph();
  flushList();
  return blocks;
}

function isMarkdownTableLine(line: string) {
  return line.trim().startsWith("|") && line.trim().endsWith("|");
}

function parseMarkdownTableRow(line: string) {
  return line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
}

function isMarkdownTableSeparator(row: string[]) {
  return row.every((cell) => /^[-:]+$/.test(cell));
}

export function looksLikeFilePath(text: string): boolean {
  if (/^[A-Za-z]:[/\\]/.test(text)) return true;
  if (/^\/[a-zA-Z0-9]/.test(text) && text.includes("/")) return true;
  if (/^\.\.?[/\\]/.test(text)) return true;
  // relative path: contains "/" and ends with a file extension
  if (/\/[a-zA-Z0-9_.-]+\.[a-zA-Z]{1,10}$/.test(text) && !/\s/.test(text)) return true;
  return false;
}

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").replace(/\r/g, "");
}

export function pathBasename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p;
}

export function resolveCodexDisplayPath(rawPath: string, workspacePath?: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;
  if (/^[A-Za-z]:[/\\]/.test(trimmed) || /^\/[a-zA-Z0-9]/.test(trimmed)) return trimmed;
  if (!workspacePath) return trimmed;
  const normalizedWorkspace = workspacePath.replace(/[\\/]+$/, "");
  const normalizedRelative = trimmed
    .replace(/^\.[/\\]/, "")
    .replace(/\//g, "\\")
    .replace(/^[\\/]+/, "");
  return `${normalizedWorkspace}\\${normalizedRelative}`;
}

function PathChip({ path, onOpen }: { path: string; onOpen: (p: string) => void }) {
  return (
    <button type="button" className="codex-path-chip" title={path} onClick={() => onOpen(path)}>
      {pathBasename(path)}
    </button>
  );
}

// Windows absolute path pattern used for bare-text path detection
const WIN_PATH_RE = /[A-Za-z]:[/\\][^\s"'<>|?\x00-\x1f]*/g;

function addPathLinks(
  segment: string,
  onOpenPath: ((p: string) => void) | undefined,
  parts: React.ReactNode[],
  getKey: () => number
) {
  if (!onOpenPath || !segment) {
    if (segment) parts.push(segment);
    return;
  }
  WIN_PATH_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = WIN_PATH_RE.exec(segment)) !== null) {
    if (m.index > last) parts.push(segment.slice(last, m.index));
    const raw = m[0];
    const path = raw.replace(/[.,;:!?)]+$/, "");
    const trail = raw.slice(path.length);
    parts.push(<PathChip key={getKey()} path={path} onOpen={onOpenPath} />);
    if (trail) parts.push(trail);
    last = m.index + raw.length;
  }
  if (last < segment.length) parts.push(segment.slice(last));
}

export function renderCodexInlineMarkdown(text: string, onOpenPath?: (path: string) => void): React.ReactNode[] {
  let k = 0;
  const getKey = () => k++;
  const parts: React.ReactNode[] = [];
  const pattern = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    addPathLinks(text.slice(lastIndex, m.index), onOpenPath, parts, getKey);
    const str = m[0];
    if (str[0] === "`") {
      const inner = str.slice(1, -1);
      if (onOpenPath && looksLikeFilePath(inner)) {
        parts.push(<PathChip key={getKey()} path={inner} onOpen={onOpenPath} />);
      } else {
        parts.push(<code key={getKey()}>{inner}</code>);
      }
    } else if (str.startsWith("**")) {
      parts.push(<strong key={getKey()}>{str.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={getKey()}>{str.slice(1, -1)}</em>);
    }
    lastIndex = m.index + str.length;
  }
  addPathLinks(text.slice(lastIndex), onOpenPath, parts, getKey);
  return parts;
}
