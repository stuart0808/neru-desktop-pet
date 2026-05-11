import React from "react";
import { BarChart3, CalendarDays, FileText, ListTodo, MessageCircle, Send, Settings, Sparkles } from "lucide-react";
import type { AppSettings, ConversationMessage, DesktopPetApi, PlanProposal, TodoCandidate, TodoItem } from "../../shared/types";
import { createWorkspaceThemeStyle } from "../utils/themeHelpers";
import { QuickStartPanel } from "../components/quickstart/QuickStartPanel";
import type { WorkspaceTab } from "../components/quickstart/QuickStartPanel";
import { ChatMessage } from "../components/chat/ChatMessage";
import { TodoList } from "../components/todos/TodoList";
import { CalendarPanel } from "../components/todos/CalendarPanel";
import { SummaryPanel } from "../components/todos/SummaryPanel";
import { CodexWorkspacePanel } from "../components/codex/CodexWorkspacePanel";
import { SettingsPanel } from "../components/settings/SettingsPanel";
import { useI18n } from "../i18n";

export function WorkspaceWindow() {
  const { t } = useI18n();
  const api: DesktopPetApi | undefined = window.desktopPet;
  const [messages, setMessages] = React.useState<ConversationMessage[]>([]);
  const [todos, setTodos] = React.useState<TodoItem[]>([]);
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [pendingPlan, setPendingPlan] = React.useState<PlanProposal | null>(null);
  const [planBusy, setPlanBusy] = React.useState(false);
  const [thinkingPlaceholder, setThinkingPlaceholder] = React.useState<ConversationMessage | null>(null);
  const [toast, setToast] = React.useState("");
  const [focusedTodoId, setFocusedTodoId] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<WorkspaceTab>("workspace");
  const [summaryText, setSummaryText] = React.useState("");
  const [summaryBusy, setSummaryBusy] = React.useState(false);
  const [summaryError, setSummaryError] = React.useState("");
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);
  const toastTimerRef = React.useRef<number | null>(null);
  const themeStyle = React.useMemo(
    () => createWorkspaceThemeStyle(settings?.workspaceThemeColor),
    [settings?.workspaceThemeColor]
  );

  React.useEffect(() => {
    if (focusedTodoId) setActiveTab("todos");
  }, [focusedTodoId]);

  React.useEffect(() => {
    if (activeTab !== "workspace") return;
    messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [activeTab, messages.length, pendingPlan, thinkingPlaceholder?.id]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast("");
      toastTimerRef.current = null;
    }, 1800);
  }

  const refreshSnapshot = React.useCallback(async () => {
    if (!api) return;
    const snapshot = await api.app.snapshot();
    setMessages(snapshot.messages);
    setTodos(snapshot.todos);
    setSettings(snapshot.settings);
  }, [api]);

  React.useEffect(() => {
    void refreshSnapshot();
  }, [refreshSnapshot]);

  React.useEffect(() => {
    if (!api) return;
    return api.events.onSnapshotUpdated(() => {
      void refreshSnapshot();
    });
  }, [api, refreshSnapshot]);

  React.useEffect(() => {
    if (!api) return;
    return api.events.onTodoFocus((todoId) => {
      setFocusedTodoId(todoId);
    });
  }, [api]);

  React.useEffect(() => {
    if (!api || busy) return;
    return api.events.onSelectedTextTodo((text) => {
      void sendText(
        `请根据下面这段从全局选区捕获的文字生成待办。如果它是复杂目标，请拆成可确认的计划步骤；如果只是单个事项，请生成一条待办：\n\n${text}`,
        t("我在从选中文字里整理待办...")
      );
    });
  }, [api, busy, t]);

  async function sendText(text: string, placeholderText = t("我在整理你刚刚说的内容...")) {
    if (!text || busy) return;
    setBusy(true);
    const userMessage: ConversationMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      createdAt: new Date().toISOString()
    };
    setMessages((current) => [...current, userMessage]);
    const placeholder: ConversationMessage = {
      id: `thinking-${crypto.randomUUID()}`,
      role: "assistant",
      text: placeholderText,
      createdAt: new Date().toISOString()
    };
    setThinkingPlaceholder(placeholder);
    try {
      if (!api) {
        const assistantMessage: ConversationMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: t("Neru 桌面服务暂未连接，请重启应用。"),
          createdAt: new Date().toISOString()
        };
        setMessages((current) => [...current, assistantMessage]);
        return;
      }
      const result = await api.chat.sendMessage(text);
      setMessages(await api.chat.listMessages());
      void result;
      setPendingPlan(null);
    } catch (error) {
      void error;
    } finally {
      setThinkingPlaceholder(null);
      setBusy(false);
    }
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    await sendText(text);
  }

  async function toggleTodo(todo: TodoItem) {
    if (!api) return;
    const status = todo.status === "done" ? "open" : "done";
    const updated = await api.todo.update(todo.id, {
      status,
      completedAt: status === "done" ? new Date().toISOString() : undefined
    });
    setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)));
    showToast(status === "done" ? t("已完成任务") : t("已恢复任务"));
  }

  async function deleteTodo(todo: TodoItem) {
    if (!api) return;
    const removed = await api.todo.delete(todo.id);
    setTodos((current) => current.filter((item) => item.id !== removed.id));
    showToast(t("已删除任务"));
  }

  async function updateTodo(todo: TodoItem, patch: Partial<Pick<TodoItem, "title" | "notes" | "project" | "tags" | "priority" | "status" | "remindAt" | "dueAt" | "scheduledStartAt" | "scheduledEndAt" | "isAllDayScheduled" | "subtasks" | "attachments" | "completedAt">>) {
    if (!api) return;
    const updated = await api.todo.update(todo.id, patch);
    setTodos((current) => current.map((item) => (item.id === todo.id ? updated : item)));
    showToast(t("保存成功"));
  }

  async function acceptPendingPlan() {
    if (!api || !pendingPlan || planBusy) return;
    setPlanBusy(true);
    try {
      const saved = await api.todo.acceptPlanProposal(pendingPlan.items, pendingPlan.sourceMessage);
      setTodos(await api.todo.list());
      setPendingPlan(null);
      showToast(t("已保存 {count} 个待办", { count: saved.todos.length }));
    } catch {
      // error silently
    } finally {
      setPlanBusy(false);
    }
  }

  function dismissPendingPlan() {
    setPendingPlan(null);
  }

  function updatePendingPlanItems(items: TodoCandidate[]) {
    setPendingPlan((current) => current ? { ...current, items } : current);
  }

  async function acceptMessageDraft(message: ConversationMessage) {
    const plan = message.taskDraftProposal;
    if (!api || !plan || message.taskDraftStatus !== "pending" || planBusy) return;
    setPlanBusy(true);
    try {
      const saved = await api.todo.acceptPlanProposal(plan.items, plan.sourceMessage, message.id);
      setTodos(await api.todo.list());
      setMessages(await api.chat.listMessages());
      showToast(t("已保存 {count} 个待办", { count: saved.todos.length }));
    } catch {
      // error silently
    } finally {
      setPlanBusy(false);
    }
  }

  async function dismissMessageDraft(message: ConversationMessage) {
    if (!api || !message.taskDraftProposal || message.taskDraftStatus !== "pending") return;
    await api.chat.updateTaskDraft(message.id, {
      taskDraftProposal: {
        ...message.taskDraftProposal,
        needsConfirmation: false
      },
      taskDraftStatus: "dismissed"
    });
    setMessages(await api.chat.listMessages());
  }

  async function updateMessageDraftItems(message: ConversationMessage, items: TodoCandidate[]) {
    if (!api || !message.taskDraftProposal || message.taskDraftStatus !== "pending") return;
    const nextProposal = { ...message.taskDraftProposal, items };
    setMessages((current) => current.map((item) => item.id === message.id
      ? { ...item, taskDraftProposal: nextProposal, taskDraftStatus: "pending" }
      : item));
    await api.chat.updateTaskDraft(message.id, {
      taskDraftProposal: nextProposal,
      taskDraftStatus: "pending"
    });
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    if (!api) return;
    const next = await api.settings.set(patch);
    setSettings(next);
  }

  async function clearMessages() {
    if (!api) return;
    await api.chat.clearMessages();
    setMessages([]);
  }

  async function selectPetAppearance() {
    if (!api) return;
    const appearance = await api.appearance.selectFolder();
    if (!appearance) return;
    setSettings((current) => current ? { ...current, petAppearance: appearance } : current);
  }

  async function resetPetAppearance() {
    if (!api) return;
    const next = await api.appearance.reset();
    setSettings(next);
  }

  async function generateSummary() {
    if (!api || summaryBusy) return;
    setSummaryBusy(true);
    setSummaryError("");
    try {
      setSummaryText(await api.summary.generate());
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : t("生成总结失败。"));
    } finally {
      setSummaryBusy(false);
    }
  }

  return (
    <main
      className="workspace-shell"
      style={themeStyle}
    >
      {toast && <div className="workspace-toast">{toast}</div>}
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
          <strong>Neru</strong>
          <span>{t("桌宠助手")}</span>
        </div>
        <nav className="workspace-nav" aria-label={t("Neru 工作窗口导航")}>
          <button
            className={`workspace-nav-item ${activeTab === "quickstart" ? "active" : ""}`}
            onClick={() => setActiveTab("quickstart")}
          >
            <FileText size={17} />
            {t("快速入门")}
          </button>
          <button
            className={`workspace-nav-item ${activeTab === "workspace" ? "active" : ""}`}
            onClick={() => setActiveTab("workspace")}
          >
            <MessageCircle size={17} />
            {t("对话")}
          </button>
          <button
            className={`workspace-nav-item ${activeTab === "todos" ? "active" : ""}`}
            onClick={() => setActiveTab("todos")}
          >
            <ListTodo size={17} />
            {t("待办")}
          </button>
          <button
            className={`workspace-nav-item ${activeTab === "calendar" ? "active" : ""}`}
            onClick={() => setActiveTab("calendar")}
          >
            <CalendarDays size={17} />
            {t("日历")}
          </button>
          <button
            className={`workspace-nav-item ${activeTab === "summary" ? "active" : ""}`}
            onClick={() => setActiveTab("summary")}
          >
            <BarChart3 size={17} />
            {t("总结")}
          </button>
          <button
            className={`workspace-nav-item ${activeTab === "codex" ? "active" : ""}`}
            onClick={() => setActiveTab("codex")}
          >
            <Sparkles size={17} />
            Codex
          </button>
          <button
            className={`workspace-nav-item ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings size={17} />
            {t("设置")}
          </button>
        </nav>
      </aside>

      <section className="workspace-content">
        {activeTab === "quickstart" ? (
          <QuickStartPanel
            onOpenTab={setActiveTab}
          />
        ) : activeTab === "workspace" ? (
          <section className="workspace-grid chat-only-grid">
            <section className="workspace-card chat-card">
              <div className="section-title">
                <span>{t("对话")}</span>
              </div>
              <div className="workspace-messages">
                {messages.length === 0 && <div className="empty">{t("还没有对话。")}</div>}
                {messages.slice(-20).map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    busy={planBusy}
                    onAccept={() => void acceptMessageDraft(message)}
                    onDismiss={() => void dismissMessageDraft(message)}
                    onChangeItems={(items) => void updateMessageDraftItems(message, items)}
                  />
                ))}
                {thinkingPlaceholder && (
                  <div className="message assistant thinking-message">
                    <span className="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                    {thinkingPlaceholder.text}
                  </div>
                )}
                <div ref={messagesEndRef} aria-hidden="true" />
              </div>
              <form className="workspace-composer" onSubmit={sendMessage}>
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={t("和 Neru 说话，或让她记录待办...")}
                />
                <button type="submit" disabled={busy} aria-label={t("发送")}>
                  <Send size={17} />
                </button>
              </form>
            </section>
          </section>
        ) : activeTab === "todos" ? (
          <TodoList
            todos={todos}
            focusedTodoId={focusedTodoId}
            onToggle={toggleTodo}
            onUpdate={updateTodo}
            onDelete={deleteTodo}
            onQuickAdd={(text) => {
              setActiveTab("workspace");
              void sendText(text, t("我在整理任务草案..."));
            }}
          />
        ) : activeTab === "calendar" ? (
          <CalendarPanel
            todos={todos}
            onToggle={toggleTodo}
            onUpdate={updateTodo}
            onDelete={deleteTodo}
            onQuickAdd={(text) => {
              setActiveTab("workspace");
              void sendText(text, t("我在整理任务草案..."));
            }}
          />
        ) : activeTab === "summary" ? (
          <SummaryPanel
            todos={todos}
            summaryText={summaryText}
            summaryBusy={summaryBusy}
            summaryError={summaryError}
            onGenerateSummary={() => void generateSummary()}
            onToggleTodo={toggleTodo}
            onUpdateTodo={updateTodo}
            onQuickAdd={(text) => {
              setActiveTab("workspace");
              void sendText(text, t("我在整理任务草案..."));
            }}
          />
        ) : activeTab === "codex" ? (
          <CodexWorkspacePanel api={api} settings={settings} />
        ) : (
          <section className="workspace-card settings-card">
            <div className="section-title">
              <span>{t("设置")}</span>
            </div>
            {settings ? (
              <SettingsPanel
                settings={settings}
                onChange={updateSettings}
                onClearMessages={clearMessages}
                onSelectPetAppearance={selectPetAppearance}
                onResetPetAppearance={resetPetAppearance}
                onTestReminder={async () => {
                  const reminder = await api?.reminder.test();
                  void reminder;
                }}
                api={api}
              />
            ) : (
              <div className="empty">{t("设置加载中。")}</div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}
