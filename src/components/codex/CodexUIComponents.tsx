import React from "react";
import { Bug, Check, ChevronDown, ChevronUp, ClipboardCopy, FileCode, ListChecks, Terminal, X } from "lucide-react";
import type { CodexModelSummary, CodexThreadSettings, CodexThreadSummary, CodexUiActivity } from "../../../shared/types";
import type { CodexInputSuggestion } from "../../utils/codexHelpers";
import { getCodexModelLabel, pathBasename, resolveCodexDisplayPath, stripAnsi } from "../../utils/codexHelpers";
import { useI18n } from "../../i18n";

const CHANGE_TYPE_LABELS: Record<string, string> = { add: "新增", delete: "删除", create: "新增", remove: "删除", update: "修改" };

function DiffView({ patch }: { patch: string }) {
  return (
    <pre className="codex-diff">
      {patch.split("\n").map((line, i) => {
        const cls = line.startsWith("+") && !line.startsWith("+++") ? "diff-add"
          : line.startsWith("-") && !line.startsWith("---") ? "diff-rm"
          : line.startsWith("@@") ? "diff-hunk"
          : line.startsWith("---") || line.startsWith("+++") ? "diff-file-header"
          : "";
        return <span key={i} className={cls}>{line + "\n"}</span>;
      })}
    </pre>
  );
}

export function FileChangesView({ text, workspacePath, onOpenPath }: {
  text: string;
  workspacePath: string;
  onOpenPath: (path: string) => void;
}) {
  const { t } = useI18n();
  const changes = React.useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(text);
      return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : null;
    } catch { return null; }
  }, [text]);

  if (!changes) return <pre className="codex-activity-pre">{text}</pre>;
  if (changes.length === 0) return <span className="codex-activity-empty">{t("无文件变更")}</span>;

  return (
    <div className="codex-file-changes">
      {changes.map((change, i) => {
        const relPath = typeof change.path === "string" ? change.path : null;
        const patch = typeof change.patch === "string" ? change.patch : null;
        const changeType = typeof change.type === "string" ? change.type : "update";
        const absPath = relPath ? resolveCodexDisplayPath(relPath, workspacePath) : null;
        const label = t(CHANGE_TYPE_LABELS[changeType] ?? "修改");
        return (
          <div key={i} className="codex-file-change">
            {relPath ? (
              <div className="codex-file-change-path">
                <span className={`codex-change-badge ${changeType === "add" || changeType === "create" ? "add" : changeType === "delete" || changeType === "remove" ? "delete" : "update"}`}>
                  {label}
                </span>
                <button type="button" className="codex-path-chip" title={absPath ?? relPath} onClick={() => absPath && onOpenPath(absPath)}>
                  {pathBasename(relPath)}
                </button>
              </div>
            ) : null}
            {patch ? <DiffView patch={patch} /> : null}
            {!relPath && !patch ? <pre className="codex-activity-pre">{JSON.stringify(change, null, 2)}</pre> : null}
          </div>
        );
      })}
    </div>
  );
}

export function CommandOutputView({ text }: { text: string }) {
  const clean = React.useMemo(() => stripAnsi(text), [text]);
  return <pre className="codex-command-output">{clean}</pre>;
}

export function ActivityItemContent({ item, workspacePath, onOpenPath }: {
  item: CodexUiActivity;
  workspacePath: string;
  onOpenPath: (path: string) => void;
}) {
  if (!item.text) return null;
  if (item.type === "file") {
    return <FileChangesView text={item.text} workspacePath={workspacePath} onOpenPath={onOpenPath} />;
  }
  if (item.type === "command") {
    return <CommandOutputView text={item.text} />;
  }
  return <pre className="codex-activity-pre">{item.text}</pre>;
}

function getActivityTypeLabel(type: string, t: (text: string) => string) {
  if (type === "command") return t("命令");
  if (type === "file") return t("文件");
  if (type === "plan") return t("计划");
  if (type === "reasoning") return t("推理");
  return type || t("活动");
}

function getActivityIcon(type: string) {
  if (type === "command") return <Terminal size={14} />;
  if (type === "file") return <FileCode size={14} />;
  if (type === "plan") return <ListChecks size={14} />;
  if (type === "reasoning") return <Bug size={14} />;
  return <ListChecks size={14} />;
}

function getActivitySummary(item: CodexUiActivity) {
  const text = stripAnsi(item.text ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "暂无输出";
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function getActivityStatusKind(status: string): "done" | "active" | "failed" | "neutral" {
  const normalized = status.trim().toLowerCase();
  if (["完成", "completed", "complete", "success", "succeeded", "done"].includes(normalized)) return "done";
  if (["运行中", "running", "in_progress", "in-progress", "思考中", "更新中", "待确认", "pending"].includes(normalized)) return "active";
  if (["failed", "failure", "error", "errored", "canceled", "cancelled", "失败", "错误", "已取消"].includes(normalized)) return "failed";
  return "neutral";
}

function parseRawEvent(raw: string) {
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    return null;
  }
}

function getRawEventSummary(raw: string, index: number) {
  const parsed = parseRawEvent(raw);
  const method = typeof parsed?.method === "string" ? parsed.method : "raw event";
  const kind = typeof parsed?.kind === "string" ? parsed.kind : typeof parsed?.params?.status === "string" ? parsed.params.status : undefined;
  const threadId = typeof parsed?.params?.threadId === "string"
    ? parsed.params.threadId
    : typeof parsed?.threadId === "string"
      ? parsed.threadId
      : undefined;
  const id = parsed?.id !== undefined ? String(parsed.id) : `#${index + 1}`;
  const detail = [kind, threadId ? `thread ${threadId.slice(0, 8)}` : undefined].filter(Boolean).join(" · ");
  return { id, method, detail, formatted: parsed ? JSON.stringify(parsed, null, 2) : raw };
}

export function CodexActivityDrawer({
  activity,
  rawEvents,
  workspacePath,
  onOpenPath,
  onClearRawEvents
}: {
  activity: CodexUiActivity[];
  rawEvents: string[];
  workspacePath: string;
  onOpenPath: (path: string) => void;
  onClearRawEvents: () => void;
}) {
  const { t } = useI18n();
  const drawerRef = React.useRef<HTMLElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<"activity" | "debug">("activity");
  const [expandedActivityIds, setExpandedActivityIds] = React.useState<Record<string, boolean>>({});
  const [expandedRawIndexes, setExpandedRawIndexes] = React.useState<Record<number, boolean>>({});
  const rawItems = rawEvents.slice(-40).map((raw, index) => getRawEventSummary(raw, index));

  React.useEffect(() => {
    setExpandedActivityIds((current) => Object.fromEntries(Object.entries(current).filter(([id]) => activity.some((item) => item.id === id))));
  }, [activity]);

  React.useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && drawerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  async function copyRawEvent(text: string) {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  return (
    <section ref={drawerRef} className={`codex-activity-drawer ${open ? "open" : "closed"}`}>
      <div className="codex-activity-drawer-bar">
        <button type="button" className="codex-activity-drawer-toggle" onClick={() => setOpen((current) => !current)}>
          {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          <span>{t("运行详情")}</span>
        </button>
      </div>
      {open && (
        <div className="codex-activity-drawer-panel">
          <div className="codex-activity-drawer-tabs">
            <button type="button" className={tab === "activity" ? "active" : ""} onClick={() => setTab("activity")}>
              {t("活动")} {activity.length}
            </button>
            <button type="button" className={tab === "debug" ? "active" : ""} onClick={() => setTab("debug")}>
              {t("调试")} {rawEvents.length}
            </button>
          </div>
          {tab === "activity" ? (
            <div className="codex-activity-drawer-content">
              {activity.length === 0 ? (
                <span className="codex-activity-empty">{t("暂无命令或文件活动。")}</span>
              ) : activity.map((item) => {
                const expanded = expandedActivityIds[item.id] === true;
                const statusKind = item.status ? getActivityStatusKind(item.status) : undefined;
                return (
                  <article key={item.id} className={`codex-activity-row ${item.type}`}>
                    <button type="button" className="codex-activity-row-header" onClick={() => setExpandedActivityIds((current) => ({ ...current, [item.id]: !expanded }))}>
                      <span className="codex-activity-row-icon">{getActivityIcon(item.type)}</span>
                      <span className="codex-activity-row-main">
                        <strong>{item.title}</strong>
                        <span>{getActivityTypeLabel(item.type, t)} · {t(getActivitySummary(item))}</span>
                      </span>
                      {item.status && (
                        <span className="codex-activity-status" data-status-kind={statusKind}>
                          <span aria-hidden="true" />
                          <span>{item.status}</span>
                        </span>
                      )}
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {expanded && (
                      <div className="codex-activity-row-detail">
                        <ActivityItemContent item={item} workspacePath={workspacePath} onOpenPath={onOpenPath} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="codex-activity-drawer-content">
              <div className="codex-debug-toolbar">
                <span>{t("最近 {count} 条事件", { count: rawItems.length })}</span>
                <button type="button" onClick={onClearRawEvents} disabled={!rawEvents.length}>{t("清空")}</button>
              </div>
              {rawItems.length === 0 ? (
                <span className="codex-activity-empty">{t("暂无调试事件。")}</span>
              ) : rawItems.map((item, index) => {
                const expanded = expandedRawIndexes[index] === true;
                return (
                  <article key={`${item.id}-${index}`} className="codex-debug-event">
                    <button type="button" className="codex-debug-event-header" onClick={() => setExpandedRawIndexes((current) => ({ ...current, [index]: !expanded }))}>
                      <span>{item.id}</span>
                      <strong>{item.method}</strong>
                      {item.detail && <em>{item.detail}</em>}
                      {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>
                    {expanded && (
                      <div className="codex-debug-event-detail">
                        <button type="button" onClick={() => void copyRawEvent(item.formatted)}>
                          <ClipboardCopy size={13} /> {t("复制 JSON")}
                        </button>
                        <pre>{item.formatted}</pre>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function CodexThinkingMessage() {
  const { t } = useI18n();
  return (
    <div className="codex-chat-message assistant codex-thinking-message">
      <span className="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <span>{t("Codex 正在输出...")}</span>
    </div>
  );
}

export function CodexThreadBadges({ settings, models }: { settings: CodexThreadSettings; models: CodexModelSummary[] }) {
  const { t } = useI18n();
  const model = settings.model;
  const modelLabel = model ? getCodexModelLabel(model, models) : t("默认模型");
  return (
    <div className="codex-thread-badges">
      <span>{modelLabel}</span>
      {settings.reasoningEffort && <span>{settings.reasoningEffort}</span>}
      <span>{settings.mode === "plan" ? t("计划模式") : t("默认模式")}</span>
    </div>
  );
}

export function CodexSuggestionPicker({
  suggestions,
  activeIndex,
  onHover,
  onApply
}: {
  suggestions: CodexInputSuggestion[];
  activeIndex: number;
  onHover(index: number): void;
  onApply(suggestion: CodexInputSuggestion): void;
}) {
  const { t } = useI18n();
  return (
    <div className="codex-suggestions">
      <div className="codex-suggestions-header">
        <div>
          <strong>{t("指令补全")}</strong>
          <span>{t("{count} 个匹配项，使用 ↑ ↓ 选择，Tab 或 Enter 补全。", { count: suggestions.length })}</span>
        </div>
      </div>
      <div className="codex-suggestions-list">
        {suggestions.map((suggestion, index) => (
          <button
            key={`${suggestion.value}-${index}`}
            type="button"
            className={index === activeIndex ? "active" : ""}
            onMouseEnter={() => onHover(index)}
            onClick={() => onApply(suggestion)}
          >
            <span aria-hidden="true" className="codex-suggestion-marker">{index === activeIndex ? <Check size={12} /> : null}</span>
            <span className="codex-suggestion-main">
              <strong>{suggestion.label}</strong>
              {suggestion.description && <span>{suggestion.description}</span>}
            </span>
          </button>
        ))}
      </div>
      <div className="codex-suggestions-footer">
        <span>{t("Esc 关闭")}</span>
        <span>{t("Tab / Enter 补全")}</span>
      </div>
    </div>
  );
}

export function CodexResumePicker({
  threads,
  busy,
  activeIndex,
  onHover,
  onResume,
  onClose
}: {
  threads: CodexThreadSummary[];
  busy: boolean;
  activeIndex: number;
  onHover(index: number): void;
  onResume(threadId: string): void;
  onClose(): void;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="codex-resume-picker">
      <div className="codex-resume-picker-header">
        <div>
          <strong>{t("恢复 Codex 线程")}</strong>
          <span>{t("{count} 个可恢复线程，使用 ↑ ↓ 选择，Enter 恢复。", { count: threads.length })}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("关闭恢复列表")}>
          <X size={13} />
        </button>
      </div>
      <div className="codex-resume-picker-list">
        {threads.map((thread, index) => {
          const title = thread.name || thread.preview || thread.id;
          const updatedAt = new Date((thread.updatedAt || thread.createdAt) * 1000).toLocaleString(locale);
          return (
            <button
              key={thread.id}
              type="button"
              className={index === activeIndex ? "active" : ""}
              onMouseEnter={() => onHover(index)}
              onClick={() => onResume(thread.id)}
              disabled={busy}
            >
              <span aria-hidden="true" className="codex-resume-marker">{index === activeIndex ? <Check size={12} /> : null}</span>
              <span className="codex-resume-main">
                <span className="codex-resume-title-row">
                  <strong>{title}</strong>
                  <small>{updatedAt}</small>
                </span>
                {thread.preview && thread.preview !== title && <span className="codex-resume-preview">{thread.preview}</span>}
                <span className="codex-resume-path">{thread.cwd}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="codex-resume-picker-footer">
        <span>{t("Esc 关闭")}</span>
        <span>{busy ? t("正在恢复...") : t("点击任意线程继续")}</span>
      </div>
    </div>
  );
}
