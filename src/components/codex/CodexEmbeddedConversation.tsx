import React from "react";
import { FolderOpen, ListTodo, Send, Sparkles, Square } from "lucide-react";
import type { CodexApprovalPolicy, CodexModelSummary, CodexPendingRequest, CodexSandboxPolicy, CodexSessionInfo, CodexThreadSummary, CodexUiActivity, CodexUiMessage, DesktopPetApi } from "../../../shared/types";
import { applyCodexThreadEventToSession, applyCodexUiEvent, getCodexActiveThreadSettings, getCodexEventThreadId, getCodexInputSuggestions, getNextCodexInputHistory, handleLocalCodexCommand, rememberCodexInput, resolveCodexDisplayPath } from "../../utils/codexHelpers";
import { MarkdownText } from "./MarkdownText";
import { CodexRequestCard, getCodexRequestActions, isCommandExecutionApprovalRequest } from "./CodexRequestCard";
import { CodexActivityDrawer, CodexResumePicker, CodexSuggestionPicker, CodexThinkingMessage, CodexThreadBadges } from "./CodexUIComponents";
import { useI18n } from "../../i18n";

export function CodexEmbeddedConversation({
  api,
  sessionInfo,
  sandbox,
  approval,
  onSessionChange
}: {
  api?: DesktopPetApi;
  sessionInfo: CodexSessionInfo;
  sandbox: CodexSandboxPolicy;
  approval: CodexApprovalPolicy;
  onSessionChange(session: CodexSessionInfo): void;
}) {
  const { t, locale } = useI18n();
  const startedRef = React.useRef(false);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const activeThreadIdRef = React.useRef<string | undefined>(sessionInfo.activeThreadId);
  const [session, setSession] = React.useState(sessionInfo);
  const [status, setStatus] = React.useState<"starting" | "running" | "exited" | "error">("starting");
  const [statusText, setStatusText] = React.useState(t("Codex 未启动"));
  const [input, setInput] = React.useState("");
  const [inputHistory, setInputHistory] = React.useState<string[]>([]);
  const [inputHistoryIndex, setInputHistoryIndex] = React.useState<number | null>(null);
  const [messages, setMessages] = React.useState<CodexUiMessage[]>(sessionInfo.history?.messages ?? []);
  const [activity, setActivity] = React.useState<CodexUiActivity[]>(sessionInfo.history?.activity ?? []);
  const [requests, setRequests] = React.useState<CodexPendingRequest[]>(sessionInfo.pendingRequests ?? []);
  const [requestActionIndex, setRequestActionIndex] = React.useState<Record<string, number>>({});
  const [requestErrors, setRequestErrors] = React.useState<Record<string, string>>({});
  const [resolvingRequestId, setResolvingRequestId] = React.useState<number | string | null>(null);
  const [requestsExpanded, setRequestsExpanded] = React.useState(false);
  const [rawEvents, setRawEvents] = React.useState<string[]>([]);
  const [responding, setResponding] = React.useState(false);
  const [models, setModels] = React.useState<CodexModelSummary[]>([]);
  const [resumeThreads, setResumeThreads] = React.useState<CodexThreadSummary[]>([]);
  const [resumeBusy, setResumeBusy] = React.useState(false);
  const [resumeIndex, setResumeIndex] = React.useState(0);
  const [suggestionIndex, setSuggestionIndex] = React.useState(0);
  const suggestions = getCodexInputSuggestions(input, session, models);
  const activeSettings = getCodexActiveThreadSettings(session);
  const primaryRequest = requests[0];
  const visibleRequests = requestsExpanded ? requests : requests.slice(0, 1);
  const activeCommandRequest = isCommandExecutionApprovalRequest(primaryRequest) ? primaryRequest : undefined;

  function getRequestKey(requestId: number | string): string {
    return String(requestId);
  }

  React.useEffect(() => {
    setSuggestionIndex(0);
  }, [input, suggestions.length]);

  React.useEffect(() => {
    setSession(sessionInfo);
    activeThreadIdRef.current = sessionInfo.activeThreadId;
    setMessages(sessionInfo.history?.messages ?? []);
    setActivity(sessionInfo.history?.activity ?? []);
    setRequests(sessionInfo.pendingRequests ?? []);
    setRequestActionIndex({});
    setRequestErrors({});
    setResolvingRequestId(null);
    setRequestsExpanded(false);
    setRawEvents([]);
    setResponding(false);
    setStatus("starting");
    setStatusText(t("Codex 未启动"));
    startedRef.current = false;
  }, [sessionInfo.id]);

  React.useEffect(() => {
    if (!api || startedRef.current) return;
    startedRef.current = true;
    void api.codex.startSession(session.id, { sandbox, approval })
      .then(async () => {
        const latest = await api.codex.getSession(session.id).catch(() => null);
        if (latest) {
          setSession(latest);
          activeThreadIdRef.current = latest.activeThreadId;
          setRequests(latest.pendingRequests ?? []);
          if (latest.resumeStatus?.status === "resumeFailed") {
            setStatus("error");
            setStatusText(t("线程恢复失败，请新建线程后继续。"));
            return;
          }
        }
        setStatus("running");
        setStatusText(t("Codex 已连接"));
        void api.codex.listModels(session.id).then(setModels).catch(() => undefined);
      })
      .catch((error) => {
        setStatus("error");
        setStatusText(error instanceof Error ? error.message : t("Codex 启动失败。"));
      });
  }, [api, approval, sandbox, session.id]);

  React.useEffect(() => {
    if (!api || (!messages.length && !activity.length)) return;
    const timeout = window.setTimeout(() => {
      void api.codex.updateSessionHistory(session.id, { messages, activity }).catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [api, session.id, messages, activity]);

  React.useEffect(() => {
    if (!api) return;
    const off = api.events.onCodexEvent((event) => {
      if (event.sessionId !== session.id) return;
      const eventThreadId = getCodexEventThreadId(event.payload);
      if (event.kind === "thread" && eventThreadId) {
        activeThreadIdRef.current = eventThreadId;
      setSession((current) => applyCodexThreadEventToSession(current, event.payload, eventThreadId));
      }
      const activeThreadId = activeThreadIdRef.current;
      if (event.kind !== "request" && eventThreadId && activeThreadId && eventThreadId !== activeThreadId) return;
      applyCodexUiEvent(event.kind, event.payload, {
        setMessages,
        setActivity,
        setRequests,
        setRawEvents,
        setStatus,
        setStatusText,
        setResponding
      });
    });
    return off;
  }, [api, session.id]);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, activity.length, requests.length, responding]);

  React.useEffect(() => {
    const validKeys = new Set(requests.map((request) => getRequestKey(request.id)));
    setRequestActionIndex((current) => Object.fromEntries(Object.entries(current).filter(([key]) => validKeys.has(key))));
    setRequestErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => validKeys.has(key))));
    if (resolvingRequestId !== null && !validKeys.has(getRequestKey(resolvingRequestId))) setResolvingRequestId(null);
    if (requests.length <= 1 && requestsExpanded) setRequestsExpanded(false);
  }, [requests, requestsExpanded, resolvingRequestId]);

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!api || !text) return;
    setInput("");
    rememberCodexInput(text, setInputHistory);
    setInputHistoryIndex(null);
    try {
      if (text === "/resume") {
        await openResumePicker();
        return;
      }
      const handledCommand = await handleLocalCodexCommand({
        api,
        session,
        text,
        models,
        setSession: (next) => setSession(next),
        setStatusText
      });
      if (handledCommand) return;
      if (session.resumeStatus?.status === "resumeFailed") {
        setStatus("error");
        setStatusText(t("线程恢复失败，请新建线程后继续。"));
        return;
      }
      if (status !== "running") {
        setStatus("starting");
        setStatusText(t("正在重新连接 Codex..."));
        await api.codex.startSession(session.id, { sandbox, approval });
        setStatus("running");
        setStatusText(t("Codex 已连接"));
      }
      setResponding(true);
      await api.codex.sendInput(session.id, text);
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : t("发送失败。"));
    }
  }

  async function openResumePicker() {
    if (!api) return;
    setResumeBusy(true);
    setStatusText(t("正在读取可恢复线程..."));
    try {
      await api.codex.updateSessionHistory(session.id, { messages, activity });
      const threads = await api.codex.listThreads(session.id);
      setResumeThreads(threads);
      setResumeIndex(0);
      setStatusText(threads.length ? t("选择要恢复的线程") : t("没有找到可恢复线程"));
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : t("读取可恢复线程失败。"));
    } finally {
      setResumeBusy(false);
    }
  }

  async function resumeThread(threadId: string) {
    if (!api) return;
    if (hasCurrentThreadPendingRequests()) {
      setStatusText(t("当前线程还有待审批请求，请先允许或拒绝后再切换。"));
      return;
    }
    setResumeBusy(true);
    setStatus("starting");
    setStatusText(t("正在恢复线程..."));
    try {
      const next = await api.codex.resumeThread(session.id, threadId);
      activeThreadIdRef.current = next.activeThreadId;
      setSession(next);
      setMessages(next.history?.messages ?? []);
      setActivity(next.history?.activity ?? []);
      setRequests(next.pendingRequests ?? requests);
      setRequestActionIndex({});
      setRequestErrors({});
      setResolvingRequestId(null);
      setRequestsExpanded(false);
      setRawEvents([]);
      setResumeThreads([]);
      setStatus("running");
      setStatusText(t("线程已恢复"));
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : t("恢复线程失败。"));
    } finally {
      setResumeBusy(false);
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (activeCommandRequest) {
      const key = getRequestKey(activeCommandRequest.id);
      const actions = getCodexRequestActions(activeCommandRequest, locale);
      const currentIndex = Math.min(requestActionIndex[key] ?? 0, Math.max(actions.length - 1, 0));
      const isResolvingActiveRequest = resolvingRequestId === activeCommandRequest.id;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (isResolvingActiveRequest) return;
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = Math.min(actions.length - 1, Math.max(0, currentIndex + delta));
        setRequestActionIndex((current) => ({ ...current, [key]: nextIndex }));
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (isResolvingActiveRequest) return;
        const action = actions[currentIndex] ?? actions[0];
        if (action) void resolveRequest(activeCommandRequest.id, action.response);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (isResolvingActiveRequest) return;
        const action = actions.find((item) => item.key === "decline") ?? actions.find((item) => item.key === "cancel") ?? actions[actions.length - 1];
        if (action) void resolveRequest(activeCommandRequest.id, action.response);
        return;
      }
    }
    if (resumeThreads.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setResumeIndex((current) => Math.min(resumeThreads.length - 1, current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setResumeIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const thread = resumeThreads[resumeIndex];
        if (thread) void resumeThread(thread.id);
      } else if (event.key === "Escape") {
        setResumeThreads([]);
      }
      return;
    }
    if (suggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSuggestionIndex((current) => Math.min(suggestions.length - 1, current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setSuggestionIndex((current) => Math.max(0, current - 1));
      } else if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        const suggestion = suggestions[suggestionIndex] ?? suggestions[0];
        if (suggestion) {
          setInput(suggestion.value);
          setInputHistoryIndex(null);
        }
      } else if (event.key === "Escape") {
        event.preventDefault();
        setInput("");
      }
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const next = getNextCodexInputHistory(inputHistory, inputHistoryIndex, event.key === "ArrowUp" ? -1 : 1);
      if (next) {
        event.preventDefault();
        setInputHistoryIndex(next.index);
        setInput(next.value);
      }
    }
  }

  async function resolveRequest(requestId: number | string, response: unknown) {
    if (!api) return;
    const key = getRequestKey(requestId);
    setResolvingRequestId(requestId);
    setRequestErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      await api.codex.respondRequest(session.id, requestId, response);
      setRequests((current) => current.filter((request) => request.id !== requestId));
    } catch (error) {
      setRequestErrors((current) => ({
        ...current,
        [key]: error instanceof Error ? error.message : t("提交审批失败。")
      }));
    } finally {
      setResolvingRequestId((current) => current === requestId ? null : current);
    }
  }

  async function openWorkspace() {
    if (!api) return;
    await api.codex.openWorkspace(session.id);
  }

  async function newThread() {
    if (!api) return;
    if (hasCurrentThreadPendingRequests()) {
      setStatusText(t("当前线程还有待审批请求，请先允许或拒绝后再新建线程。"));
      return;
    }
    if (messages.length === 0 && activity.length === 0) {
      setStatusText(t("当前线程还是空的"));
      return;
    }
    setStatus("starting");
    setStatusText(t("正在新建线程..."));
    try {
      await api.codex.updateSessionHistory(session.id, { messages, activity });
      const next = await api.codex.newThread(session.id);
      activeThreadIdRef.current = next.activeThreadId;
      setSession(next);
      setMessages([]);
      setActivity([]);
      setRequests(next.pendingRequests ?? requests);
      setRequestActionIndex({});
      setRequestErrors({});
      setResolvingRequestId(null);
      setRequestsExpanded(false);
      setRawEvents([]);
      setResumeThreads([]);
      setStatus("running");
      setStatusText(t("新线程已创建"));
    } catch (error) {
      setStatus("error");
      setStatusText(error instanceof Error ? error.message : t("新建线程失败。"));
    }
  }

  async function stopSession() {
    if (!api) return;
    await api.codex.stopSession(session.id);
    setStatus("exited");
    setStatusText(t("Codex 已停止"));
  }

  const handleOpenPath = React.useCallback((path: string) => {
    if (!api?.app.openPath) {
      setStatusText(t("Neru 暂时无法打开该路径，请重启应用。"));
      return;
    }
    const targetPath = resolveCodexDisplayPath(path, session.workspacePath);
    void api.app.openPath(targetPath).then((result) => {
      if (!result.ok) setStatusText(result.message ?? t("打开路径失败。"));
    }).catch((error) => {
      setStatusText(error instanceof Error ? error.message : t("打开路径失败。"));
    });
  }, [api, session.workspacePath]);

  function hasCurrentThreadPendingRequests(): boolean {
    const activeThreadId = activeThreadIdRef.current ?? session.activeThreadId;
    return requests.some((request) => !request.threadId || request.threadId === activeThreadId);
  }

  React.useEffect(() => {
    onSessionChange({ ...session, history: { messages, activity } });
  }, [activity, messages, onSessionChange, session]);

  return (
    <div className="codex-embedded">
      <header className="codex-embedded-header">
        <div>
          <strong>{session.copiedItems[0]?.copiedName ?? t("Codex 对话")}</strong>
          <span>{session.workspacePath}</span>
        </div>
        <div className="codex-embedded-actions">
          <CodexThreadBadges settings={activeSettings} models={models} />
          <CodexActivityDrawer
            activity={activity}
            rawEvents={rawEvents}
            workspacePath={session.workspacePath}
            onOpenPath={handleOpenPath}
            onClearRawEvents={() => setRawEvents([])}
          />
          <button type="button" onClick={() => void openWorkspace()}><FolderOpen size={14} /> {t("打开目录")}</button>
          <button type="button" onClick={() => void openResumePicker()} disabled={status === "starting"}><ListTodo size={14} /> {t("线程")}</button>
          <button type="button" onClick={() => void newThread()} disabled={status === "starting"}><Sparkles size={14} /> {t("新建线程")}</button>
          <button type="button" onClick={() => void stopSession()} disabled={status !== "running"}><Square size={14} /> {t("停止")}</button>
          <span className={`codex-status ${status}`}>{statusText}</span>
        </div>
      </header>
      <div className="codex-message-list">
        {messages.length === 0 && activity.length === 0 && <div className="codex-empty">{t("输入指令后开始和 Codex 对话。")}</div>}
        {messages.map((message) => (
          <div key={message.id} className={`codex-chat-message ${message.role}`}>
            <strong>{message.role === "user" ? t("你") : message.role === "assistant" ? "Codex" : t("系统")}</strong>
            <MarkdownText text={message.text} onOpenPath={handleOpenPath} />
          </div>
        ))}
        {requests.length > 0 && (
          <section className={`codex-request-stack ${requestsExpanded ? "expanded" : "collapsed"} ${requests.length > 1 ? "multi" : ""}`} aria-label={t("待审批请求")}>
            <div className="codex-request-stack-header">
              <div>
                <strong>{t("待审批请求")}</strong>
                <span>{t("{count} 个请求等待处理", { count: requests.length })}</span>
              </div>
              {requests.length > 1 && (
                <button type="button" onClick={() => setRequestsExpanded((current) => !current)}>
                  {requestsExpanded ? t("收起") : t("展开全部")}
                </button>
              )}
            </div>
            <div className="codex-request-stack-list">
              {visibleRequests.map((request) => (
                <CodexRequestCard
                  key={request.id}
                  request={request}
                  activeIndex={requestActionIndex[getRequestKey(request.id)] ?? 0}
                  resolving={resolvingRequestId === request.id}
                  error={requestErrors[getRequestKey(request.id)]}
                  onActiveIndexChange={(index) => setRequestActionIndex((current) => ({ ...current, [getRequestKey(request.id)]: index }))}
                  onResolve={(response) => void resolveRequest(request.id, response)}
                />
              ))}
            </div>
          </section>
        )}
        {responding && <CodexThinkingMessage />}
        <div ref={messagesEndRef} aria-hidden="true" />
      </div>
      <form className="codex-composer" onSubmit={sendMessage}>
        {resumeThreads.length > 0 && (
          <CodexResumePicker
            threads={resumeThreads}
            busy={resumeBusy}
            activeIndex={resumeIndex}
            onHover={setResumeIndex}
            onResume={(threadId) => void resumeThread(threadId)}
            onClose={() => setResumeThreads([])}
          />
        )}
        {suggestions.length > 0 && (
          <CodexSuggestionPicker
            suggestions={suggestions}
            activeIndex={suggestionIndex}
            onHover={setSuggestionIndex}
            onApply={(suggestion) => {
              setInput(suggestion.value);
              setInputHistoryIndex(null);
            }}
          />
        )}
        <div>
          <textarea value={input} rows={Math.min(10, Math.max(2, input.split(/\r?\n/).length))} onKeyDown={handleComposerKeyDown} onChange={(event) => {
            setInput(event.target.value);
            setInputHistoryIndex(null);
          }} placeholder={t("输入指令，支持 /model、/review、/compact、@文件名...")} />
          <button type="submit" disabled={!input.trim() || status === "starting" || session.resumeStatus?.status === "resumeFailed"}>
            <Send size={16} />
          </button>
        </div>
      </form>
    </div>
  );
}
