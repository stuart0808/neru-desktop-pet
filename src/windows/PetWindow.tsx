import React from "react";
import { Bell, Check, ListTodo, Paperclip, Send } from "lucide-react";
import type { AppSettings, CodexApprovalPolicy, CodexDropItem, CodexSandboxPolicy, ConversationMessage, DesktopPetApi, PetMood, PlanProposal, ReminderItem, TodoItem } from "../../shared/types";
import { createWorkspaceThemeStyle } from "../utils/themeHelpers";
import { petStateImages } from "../utils/constants";
import { getPetVisualState, getTransientMoodDuration, isOverdueOpenTodo, mergePetImages } from "../utils/petHelpers";
import type { LocalPetMood } from "../utils/petHelpers";
import { hasFileDrop, getDropItems, dedupeCodexItems } from "../utils/codexHelpers";
import { PlanProposalCard } from "../components/chat/PlanProposalCard";
import { CodexBasketPopover } from "../components/codex/CodexBasketPopover";
import { useI18n } from "../i18n";

const defaultPetMetrics = {
  renderWidth: 123,
  renderHeight: 260,
  bubbleBottom: 274,
  layout: {
    collapsed: { width: 180, height: 300 },
    expanded: { width: 560, height: 720 }
  }
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function calculatePetMetrics(naturalWidth: number, naturalHeight: number, scale = 1) {
  const ratio = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : defaultPetMetrics.renderWidth / defaultPetMetrics.renderHeight;
  const maxRenderWidth = 360;
  const maxRenderHeight = 260;
  let renderWidth = maxRenderHeight * ratio;
  let renderHeight = maxRenderHeight;
  if (renderWidth > maxRenderWidth) {
    renderWidth = maxRenderWidth;
    renderHeight = maxRenderWidth / ratio;
  }
  const petScale = clamp(scale, 0.6, 1.4);
  renderWidth = Math.round(clamp(renderWidth, 96, maxRenderWidth) * petScale);
  renderHeight = Math.round(clamp(renderHeight, 150, maxRenderHeight) * petScale);
  const collapsedWidth = Math.round(clamp(renderWidth + 32, 140, 560));
  const collapsedHeight = Math.round(clamp(renderHeight + 40, 190, 420));
  return {
    renderWidth,
    renderHeight,
    bubbleBottom: renderHeight + 14,
    layout: {
      collapsed: { width: collapsedWidth, height: collapsedHeight },
      expanded: {
        width: Math.round(clamp(Math.max(560, collapsedWidth + 140), 560, 860)),
        height: Math.round(clamp(Math.max(720, collapsedHeight + 360), 720, 940))
      }
    }
  };
}

function NeruPet({ state, images, showAlert }: { state: ReturnType<typeof getPetVisualState>; images: Record<ReturnType<typeof getPetVisualState>, string>; showAlert: boolean }) {
  return (
    <span className={`pet-image-wrap pet-${state}`}>
      <img className="pet-image" src={images[state]} alt={`Q版桌宠 ${state} 状态`} draggable={false} />
      {showAlert && <span className="reminder-star" aria-hidden="true">!</span>}
    </span>
  );
}

export function PetWindow() {
  const { t } = useI18n();
  const api: DesktopPetApi | undefined = window.desktopPet;
  const [messages, setMessages] = React.useState<ConversationMessage[]>([]);
  const [todos, setTodos] = React.useState<TodoItem[]>([]);
  const [settings, setSettings] = React.useState<AppSettings | null>(null);
  const [input, setInput] = React.useState("");
  const [mood, setMood] = React.useState<LocalPetMood>("idle");
  const [chatOpen, setChatOpen] = React.useState(false);
  const [bubble, setBubble] = React.useState(t("今天也一起把事情整理清楚。"));
  const [busy, setBusy] = React.useState(false);
  const [pendingPlan, setPendingPlan] = React.useState<PlanProposal | null>(null);
  const [planBusy, setPlanBusy] = React.useState(false);
  const [thinkingPlaceholder, setThinkingPlaceholder] = React.useState<ConversationMessage | null>(null);
  const [miniMessage, setMiniMessage] = React.useState<ConversationMessage | null>(null);
  const [activeReminder, setActiveReminder] = React.useState<ReminderItem | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const [dragging, setDragging] = React.useState(false);
  const [codexDragActive, setCodexDragActive] = React.useState(false);
  const [codexBasketOpen, setCodexBasketOpen] = React.useState(false);
  const [codexItems, setCodexItems] = React.useState<CodexDropItem[]>([]);
  const [codexSandbox, setCodexSandbox] = React.useState<CodexSandboxPolicy>("workspace-write");
  const [codexApproval, setCodexApproval] = React.useState<CodexApprovalPolicy>("on-request");
  const [codexCreateBusy, setCodexCreateBusy] = React.useState(false);
  const [codexError, setCodexError] = React.useState("");
  const [lastInteractionAt, setLastInteractionAt] = React.useState(() => Date.now());
  const [petMetrics, setPetMetrics] = React.useState(defaultPetMetrics);
  const clickTimerRef = React.useRef<number | null>(null);
  const miniCloseTimerRef = React.useRef<number | null>(null);
  const toastTimerRef = React.useRef<number | null>(null);
  const miniInputRef = React.useRef<HTMLInputElement | null>(null);
  const pointerStartRef = React.useRef<{ screenX: number; screenY: number } | null>(null);
  const didDragRef = React.useRef(false);
  const sentLayoutRef = React.useRef("");
  const hasOverdueOpenTodo = React.useMemo(
    () => todos.some((todo) => isOverdueOpenTodo(todo, now)),
    [todos, now]
  );
  const visualState = React.useMemo(
    () => getPetVisualState({
      mood,
      dragging,
      hasOverdueOpenTodo,
      idleMs: now - lastInteractionAt,
      chatOpen
    }),
    [chatOpen, dragging, hasOverdueOpenTodo, lastInteractionAt, mood, now]
  );
  const themeStyle = React.useMemo(
    () => createWorkspaceThemeStyle(settings?.workspaceThemeColor),
    [settings?.workspaceThemeColor]
  );
  const currentPetImages = React.useMemo(
    () => mergePetImages(petStateImages, settings?.petAppearance?.images),
    [settings?.petAppearance?.images]
  );
  const petDisplayScale = settings?.petDisplayScale ?? 1;
  const petStageStyle = React.useMemo(
    () => ({
      ...themeStyle,
      "--pet-render-width": `${petMetrics.renderWidth}px`,
      "--pet-render-height": `${petMetrics.renderHeight}px`,
      "--pet-bubble-bottom": `${petMetrics.bubbleBottom}px`
    } as React.CSSProperties),
    [petMetrics.bubbleBottom, petMetrics.renderHeight, petMetrics.renderWidth, themeStyle]
  );

  void pendingPlan;
  void setPendingPlan;

  function markInteraction() {
    setLastInteractionAt(Date.now());
  }

  function scheduleMiniClose(delay = 3000) {
    if (miniCloseTimerRef.current) window.clearTimeout(miniCloseTimerRef.current);
    miniCloseTimerRef.current = window.setTimeout(() => {
      setChatOpen(false);
      setMiniMessage(null);
      miniCloseTimerRef.current = null;
    }, delay);
  }

  const refreshSnapshot = React.useCallback(async () => {
    if (!api) return;
    const snapshot = await api.app.snapshot();
    setMessages(snapshot.messages);
    setTodos(snapshot.todos);
    setSettings(snapshot.settings);
  }, [api]);

  React.useEffect(() => {
    if (!api) {
      setBubble(t("Neru 桌面服务暂未连接，请重启应用。"));
      return;
    }
    void refreshSnapshot();
    return api.events.onReminderFired((reminder) => {
      markInteraction();
      setMood("reminder" as PetMood);
      setActiveReminder(reminder.todoId ? reminder : null);
      setBubble(reminder.message);
      setMiniMessage(null);
      setChatOpen(false);
      void api.todo.list().then(setTodos);
      void api.reminder.list();
    });
  }, [api, refreshSnapshot]);

  React.useEffect(() => {
    if (!api) return;
    return api.events.onSnapshotUpdated(() => {
      void refreshSnapshot();
    });
  }, [api, refreshSnapshot]);

  React.useEffect(() => {
    if (dragging || !chatOpen || input.trim() || busy || activeReminder || miniMessage?.taskDraftProposal) return;
    const timer = window.setTimeout(() => setChatOpen(false), 5000);
    return () => window.clearTimeout(timer);
  }, [activeReminder, busy, chatOpen, dragging, input, miniMessage?.taskDraftProposal]);

  React.useEffect(() => {
    if (!api || dragging) return;
    void api.app.setPetWindowExpanded(chatOpen || codexBasketOpen);
  }, [api, chatOpen, codexBasketOpen, dragging]);

  React.useEffect(() => {
    const image = new Image();
    image.onload = () => {
      setPetMetrics(calculatePetMetrics(image.naturalWidth, image.naturalHeight, petDisplayScale));
    };
    image.onerror = () => {
      setPetMetrics(calculatePetMetrics(defaultPetMetrics.renderWidth, defaultPetMetrics.renderHeight, petDisplayScale));
    };
    image.src = currentPetImages.idle;
  }, [currentPetImages.idle, petDisplayScale]);

  React.useEffect(() => {
    if (!api) return;
    const serialized = JSON.stringify(petMetrics.layout);
    if (sentLayoutRef.current === serialized) return;
    sentLayoutRef.current = serialized;
    void api.app.setPetWindowLayout(petMetrics.layout);
  }, [api, petMetrics.layout]);

  React.useEffect(() => {
    return () => {
      if (clickTimerRef.current) window.clearTimeout(clickTimerRef.current);
      if (miniCloseTimerRef.current) window.clearTimeout(miniCloseTimerRef.current);
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (mood === "idle" || mood === "thinking") return;
    const duration = getTransientMoodDuration(mood);
    const timer = window.setTimeout(() => {
      setMood((current) => (current === mood ? "idle" : current));
    }, duration);
    return () => window.clearTimeout(timer);
  }, [mood]);

  React.useEffect(() => {
    if (!settings) return;
    setCodexSandbox(settings.codexDefaultSandbox);
    setCodexApproval(settings.codexDefaultApproval);
  }, [settings?.codexDefaultApproval, settings?.codexDefaultSandbox]);

  React.useEffect(() => {
    if (!api) return;
    return api.events.onQuickAiRecord(() => {
      markInteraction();
      setChatOpen(true);
      setMiniMessage(null);
      setMood("talking" as PetMood);
      setBubble(t("要记录什么？直接告诉我。"));
      window.setTimeout(() => miniInputRef.current?.focus(), 80);
    });
  }, [api]);

  async function sendText(text: string, placeholderText = t("我在整理你刚刚说的内容...")) {
    if (!text || busy) return;
    setBusy(true);
    setMiniMessage(null);
    if (miniCloseTimerRef.current) {
      window.clearTimeout(miniCloseTimerRef.current);
      miniCloseTimerRef.current = null;
    }
    markInteraction();
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
    setMood("thinking" as PetMood);
    setBubble(placeholderText);
    try {
      if (!api) {
        const assistantMessage: ConversationMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: t("Neru 桌面服务暂未连接，请重启应用。"),
          createdAt: new Date().toISOString()
        };
        setMessages((current) => [...current, assistantMessage]);
        setMood("idle");
        setBubble(assistantMessage.text);
        setMiniMessage(assistantMessage);
        return;
      }
      const result = await api.chat.sendMessage(text);
      setMessages(await api.chat.listMessages());
      setMood(result.mood);
      setBubble(result.assistantMessage.text);
      setMiniMessage(result.assistantMessage);
      setPendingPlan(null);
    } catch (error) {
      setMood("confused");
      setBubble(error instanceof Error ? error.message : t("对话失败，请稍后再试。"));
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

  async function acceptMiniDraft(message: ConversationMessage) {
    const plan = message.taskDraftProposal;
    if (!api || !plan || message.taskDraftStatus !== "pending" || planBusy) return;
    markInteraction();
    setPlanBusy(true);
    try {
      const saved = await api.todo.acceptPlanProposal(plan.items, plan.sourceMessage, message.id);
      setTodos(await api.todo.list());
      setMessages(await api.chat.listMessages());
      setMood("happy" as PetMood);
      setBubble(t("已写入 {count} 个待办。", { count: saved.todos.length }));
      setMiniMessage({ ...message, taskDraftStatus: "accepted" });
      scheduleMiniClose();
    } catch (error) {
      setMood("confused");
      setBubble(error instanceof Error ? error.message : t("写入计划失败，请稍后再试。"));
    } finally {
      setPlanBusy(false);
    }
  }

  async function dismissMiniDraft(message: ConversationMessage) {
    if (!api || !message.taskDraftProposal || message.taskDraftStatus !== "pending") return;
    markInteraction();
    await api.chat.updateTaskDraft(message.id, {
      taskDraftProposal: { ...message.taskDraftProposal, needsConfirmation: false },
      taskDraftStatus: "dismissed"
    });
    setMessages(await api.chat.listMessages());
    setBubble(t("好的，这个草案已标记为未采纳。"));
    setMiniMessage({ ...message, taskDraftStatus: "dismissed" });
    scheduleMiniClose();
  }

  async function completeActiveReminder() {
    if (!api || !activeReminder) return;
    markInteraction();
    await api.reminder.complete(activeReminder.id);
    setTodos(await api.todo.list());
    setActiveReminder(null);
    setChatOpen(false);
    setMood("happy" as PetMood);
    setBubble(t("已完成：{title}", { title: activeReminder.title }));
  }

  async function snoozeActiveReminder(minutes: number) {
    if (!api || !activeReminder) return;
    markInteraction();
    await api.reminder.snooze(activeReminder.id, minutes);
    setActiveReminder(null);
    setChatOpen(false);
    setMood("idle");
    setBubble(t("{minutes} 分钟后再提醒你。", { minutes }));
  }

  function openActiveReminderTodo() {
    if (!activeReminder?.todoId) return;
    markInteraction();
    void api?.app.openWorkspaceWindow(activeReminder.todoId);
  }

  function handlePetPointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    markInteraction();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerStartRef.current = { screenX: event.screenX, screenY: event.screenY };
    didDragRef.current = false;
    void api?.app.beginWindowDrag();
  }

  function handlePetPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!api || !pointerStartRef.current) return;
    const totalDx = Math.abs(event.screenX - pointerStartRef.current.screenX);
    const totalDy = Math.abs(event.screenY - pointerStartRef.current.screenY);
    if (!didDragRef.current && totalDx < 5 && totalDy < 5) return;
    didDragRef.current = true;
    setDragging(true);
    void api.app.dragWindowToCursor();
  }

  function handlePetPointerUp(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    pointerStartRef.current = null;
    void api?.app.endWindowDrag();
  }

  function handlePetClick() {
    markInteraction();
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    if (clickTimerRef.current) return;
    clickTimerRef.current = window.setTimeout(() => {
      setChatOpen((open) => {
        const next = !open;
        if (next) {
          setMiniMessage(null);
          window.setTimeout(() => miniInputRef.current?.focus(), 80);
        }
        return next;
      });
      clickTimerRef.current = null;
    }, 180);
  }

  function handlePetDoubleClick() {
    markInteraction();
    if (clickTimerRef.current) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    void api?.app.openWorkspaceWindow();
  }

  function handleCodexDragOver(event: React.DragEvent) {
    if (!hasFileDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setCodexDragActive(true);
  }

  function handleCodexDragLeave(event: React.DragEvent) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setCodexDragActive(false);
    }
  }

  function handleCodexDrop(event: React.DragEvent) {
    if (!hasFileDrop(event)) return;
    event.preventDefault();
    setCodexDragActive(false);
    const items = getDropItems(event.dataTransfer, api);
    if (!items.length) return;
    setCodexItems((current) => dedupeCodexItems([...current, ...items]));
    setCodexBasketOpen(true);
    setChatOpen(false);
    setMiniMessage(null);
    setCodexError("");
    setMood("talking" as PetMood);
    setBubble(t("已加入 {count} 个项目，确认后再交给 Codex。", { count: items.length }));
    markInteraction();
  }

  async function startCodexFromBasket() {
    if (!api || !codexItems.length || codexCreateBusy) return;
    setCodexCreateBusy(true);
    setCodexError("");
    try {
      await api.codex.createSession(codexItems, {
        sandbox: codexSandbox,
        approval: codexApproval
      });
      setCodexBasketOpen(false);
      setCodexItems([]);
      setMood("happy" as PetMood);
      setBubble(t("Codex 会话已打开。"));
    } catch (error) {
      setMood("confused");
      setCodexError(error instanceof Error ? error.message : t("启动 Codex 失败。"));
    } finally {
      setCodexCreateBusy(false);
    }
  }

  return (
    <main
      className={`shell pet-only ${chatOpen ? "chat-open" : ""} ${codexBasketOpen ? "codex-basket-open" : ""} ${codexDragActive ? "codex-drag-active" : ""}`}
      style={petStageStyle}
      onDragEnter={handleCodexDragOver}
      onDragOver={handleCodexDragOver}
      onDragLeave={handleCodexDragLeave}
      onDrop={handleCodexDrop}
    >
      <section className="pet-stage">
        {codexDragActive && (
          <div className="codex-drop-overlay">
            <Paperclip size={18} />
            <strong>{t("松开加入 Codex 文件篮")}</strong>
          </div>
        )}
        {codexBasketOpen && (
          <CodexBasketPopover
            items={codexItems}
            sandbox={codexSandbox}
            approval={codexApproval}
            busy={codexCreateBusy}
            error={codexError}
            onSandboxChange={setCodexSandbox}
            onApprovalChange={setCodexApproval}
            onRemove={(path) => setCodexItems((current) => current.filter((item) => item.path !== path))}
            onClear={() => setCodexItems([])}
            onClose={() => setCodexBasketOpen(false)}
            onStart={() => void startCodexFromBasket()}
          />
        )}
        {!chatOpen && activeReminder && bubble && (
          <div className="reminder-bubble">
            {bubble}
          </div>
        )}
        {chatOpen && (
          <section className="chat-popover">
            {miniMessage?.taskDraftProposal ? (
              <PlanProposalCard
                plan={miniMessage.taskDraftProposal}
                compact
                busy={planBusy}
                status={miniMessage.taskDraftStatus}
                onAccept={() => void acceptMiniDraft(miniMessage)}
                onDismiss={() => void dismissMiniDraft(miniMessage)}
                onChangeItems={(items) => {
                  setMiniMessage((current) => current?.id === miniMessage.id && current.taskDraftProposal
                    ? { ...current, taskDraftProposal: { ...current.taskDraftProposal, items } }
                    : current);
                }}
              />
            ) : (
              (miniMessage?.text || activeReminder) && <div className="speech-bubble">{miniMessage?.text ?? bubble}</div>
            )}
            {activeReminder?.todoId && (
              <div className="reminder-actions" aria-label="提醒操作">
                <button type="button" onClick={() => void completeActiveReminder()}>
                  <Check size={14} /> {t("完成")}
                </button>
                <button type="button" onClick={() => void snoozeActiveReminder(10)}>
                  <Bell size={14} /> {t("10 分钟后")}
                </button>
                <button type="button" onClick={openActiveReminderTodo}>
                  <ListTodo size={14} /> {t("打开待办")}
                </button>
              </div>
            )}
            {thinkingPlaceholder && !miniMessage && (
              <div className="mini-thinking">
                <span className="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
                {thinkingPlaceholder.text}
              </div>
            )}
            {!busy && !miniMessage && !activeReminder && (
              <form className="mini-composer" onSubmit={sendMessage}>
                <input
                  ref={miniInputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={t("和 Neru 说话...")}
                />
                <button type="submit" disabled={busy} aria-label={t("发送")}>
                  <Send size={16} />
                </button>
              </form>
            )}
          </section>
        )}

        <button
          className="pet-button"
          onPointerDown={handlePetPointerDown}
          onPointerMove={handlePetPointerMove}
          onPointerUp={handlePetPointerUp}
          onPointerCancel={handlePetPointerUp}
          onClick={handlePetClick}
          onDoubleClick={handlePetDoubleClick}
          aria-label={t("单击对话，打开 Neru 主窗口，拖动移动位置")}
        >
          <NeruPet state={visualState} images={currentPetImages} showAlert={hasOverdueOpenTodo} />
        </button>
        {!api && <div className="debug-banner">{t("Neru 桌面服务暂未连接。")}</div>}
      </section>
    </main>
  );
}
