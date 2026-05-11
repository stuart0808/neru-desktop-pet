import React from "react";
import { AlertTriangle, BarChart3, CalendarDays, Search, Send, Sparkles } from "lucide-react";
import type { TodoItem, TodoPriority } from "../../../shared/types";
import { getSummaryDashboardData } from "../../utils/todoHelpers";
import { formatSummaryRangeTitle } from "../../utils/formatHelpers";
import { formatRelativeTodoTime } from "../../utils/formatHelpers";
import { formatScheduledTime } from "../../utils/dateHelpers";
import { useI18n } from "../../i18n";

function SummaryPlanGroup({
  title,
  items,
  emptyText,
  collapsible = false,
  onComplete,
  onScheduleToday,
  onPostpone
}: {
  title: string;
  items: TodoItem[];
  emptyText: string;
  collapsible?: boolean;
  onComplete(todo: TodoItem): void;
  onScheduleToday(todo: TodoItem): void;
  onPostpone(todo: TodoItem): void;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  const { t } = useI18n();
  return (
    <section className="summary-plan-group">
      <button type="button" className="summary-plan-group-title" onClick={() => collapsible && setCollapsed((value) => !value)}>
        <span>{title}</span>
        <small>{items.length}</small>
      </button>
      {!collapsed && (
        <div className="summary-action-list">
          {items.length === 0 && <div className="summary-empty">{emptyText}</div>}
          {items.map((todo) => (
            <div key={todo.id} className="summary-action-item">
              <div>
                <strong>{todo.title}</strong>
                <span>
                  {todo.scheduledStartAt ? formatScheduledTime(todo) : todo.dueAt ? formatRelativeTodoTime(todo) : t("无日期")}
                  {todo.project ? ` · ${todo.project}` : ""}
                </span>
              </div>
              <div>
                <button type="button" onClick={() => onComplete(todo)}>{t("完成")}</button>
                <button type="button" onClick={() => onScheduleToday(todo)}>{t("安排")}</button>
                <button type="button" onClick={() => onPostpone(todo)}>{t("延后")}</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="summary-metric">
      <strong>{value}{suffix}</strong>
      <span>{label}</span>
    </div>
  );
}

function CompactTodoList({ todos, emptyText, urgent = false }: { todos: TodoItem[]; emptyText: string; urgent?: boolean }) {
  const { locale } = useI18n();
  if (todos.length === 0) return <div className="summary-empty">{emptyText}</div>;
  return (
    <div className="summary-todo-list">
      {todos.slice(0, 5).map((todo) => (
        <div key={todo.id} className={`summary-todo ${urgent ? "urgent" : ""}`}>
          <span>{todo.title}</span>
          {(todo.remindAt || todo.dueAt) && <small>{new Date(todo.remindAt ?? todo.dueAt!).toLocaleString(locale)}</small>}
        </div>
      ))}
    </div>
  );
}

export { CompactTodoList };

function formatSummaryRiskTime(todo: TodoItem, locale: string, t: (text: string, params?: Record<string, string | number>) => string) {
  const source = todo.dueAt ?? todo.remindAt;
  if (!source) return "";
  const date = new Date(source);
  if (!Number.isFinite(date.getTime())) return "";
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = todayStart.getTime() + 24 * 60 * 60_000;
  const dayAfterTomorrowStart = tomorrowStart + 24 * 60 * 60_000;
  const timeText = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  if (date.getTime() < Date.now()) return t("逾期 {time}", { time: date.toLocaleString(locale) });
  if (date.getTime() < tomorrowStart) return t("今天 {time}", { time: timeText });
  if (date.getTime() < dayAfterTomorrowStart) return t("明天 {time}", { time: timeText });
  return date.toLocaleString(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function SummaryPanel({
  todos,
  summaryText,
  summaryBusy,
  summaryError,
  onGenerateSummary,
  onToggleTodo,
  onUpdateTodo,
  onQuickAdd
}: {
  todos: TodoItem[];
  summaryText: string;
  summaryBusy: boolean;
  summaryError: string;
  onGenerateSummary(): void;
  onToggleTodo(todo: TodoItem): void;
  onUpdateTodo(todo: TodoItem, patch: Partial<Pick<TodoItem, "title" | "notes" | "project" | "tags" | "priority" | "status" | "remindAt" | "dueAt" | "scheduledStartAt" | "scheduledEndAt" | "isAllDayScheduled" | "subtasks" | "attachments" | "completedAt">>): void;
  onQuickAdd(text: string): void;
}) {
  const { t, locale } = useI18n();
  type SummaryRange = "today" | "week" | "month";
  const [range, setRange] = React.useState<SummaryRange>("today");
  const [searchText, setSearchText] = React.useState("");
  const [priorityFilter, setPriorityFilter] = React.useState<TodoPriority | "all">("all");
  const [quickText, setQuickText] = React.useState("");
  const data = React.useMemo(() => getSummaryDashboardData(todos, { searchText, priorityFilter }), [priorityFilter, searchText, todos]);

  function submitQuickAdd(event: React.FormEvent) {
    event.preventDefault();
    const text = quickText.trim();
    if (!text) return;
    onQuickAdd(text);
    setQuickText("");
  }

  function scheduleToday(todo: TodoItem) {
    const start = new Date();
    start.setMinutes(start.getMinutes() < 30 ? 30 : 0, 0, 0);
    if (start.getTime() < Date.now()) start.setHours(start.getHours() + 1);
    const end = new Date(start.getTime() + 60 * 60_000);
    onUpdateTodo(todo, {
      scheduledStartAt: start.toISOString(),
      scheduledEndAt: end.toISOString(),
      isAllDayScheduled: false
    });
  }

  function postponeTomorrow(todo: TodoItem) {
    const date = new Date();
    date.setDate(date.getDate() + 1);
    date.setHours(18, 0, 0, 0);
    onUpdateTodo(todo, { dueAt: date.toISOString() });
  }

  return (
    <section className="summary-page">
      <div className="summary-toolbar">
        <div className="summary-range-controls">
          {(["today", "week", "month"] as SummaryRange[]).map((item) => (
            <button key={item} type="button" className={range === item ? "active" : ""} onClick={() => setRange(item)}>
              {item === "today" ? t("今天") : item === "week" ? t("本周") : t("本月")}
            </button>
          ))}
          <strong>{formatSummaryRangeTitle(range, locale)}</strong>
        </div>
        <label className="summary-search">
          <Search size={14} />
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t("搜索任务")} />
        </label>
        <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as TodoPriority | "all")}>
          <option value="all">{t("全部优先级")}</option>
          <option value="urgent">P0</option>
          <option value="high">P1</option>
          <option value="medium">P2</option>
          <option value="low">P3</option>
        </select>
        <form className="summary-quick-add" onSubmit={submitQuickAdd}>
          <input value={quickText} onChange={(event) => setQuickText(event.target.value)} placeholder={t("快速新建：明天 5 点 @项目 #标签")} />
          <button type="submit"><Send size={14} /></button>
        </form>
      </div>

      <div className="summary-main-column">
        <section className="summary-card summary-plan-card">
          <div className="summary-card-title">
            <CalendarDays size={17} />
            {t("计划")}
          </div>
          <SummaryPlanGroup title={t("今日已计划")} items={data.scheduledToday} emptyText={t("今天还没有安排时间块。")} onComplete={onToggleTodo} onScheduleToday={scheduleToday} onPostpone={postponeTomorrow} />
          <SummaryPlanGroup title={t("今日到期但未计划")} items={data.dueTodayUnscheduled} emptyText={t("今天没有到期未计划任务。")} onComplete={onToggleTodo} onScheduleToday={scheduleToday} onPostpone={postponeTomorrow} />
          <SummaryPlanGroup title={t("接下来 7 天重点")} items={data.next7Focus.slice(0, 5)} emptyText={t("未来 7 天没有需要提前关注的任务。")} collapsible onComplete={onToggleTodo} onScheduleToday={scheduleToday} onPostpone={postponeTomorrow} />
        </section>

        <section className="summary-card summary-review-card">
          <div className="summary-card-title">
            <BarChart3 size={17} />
            {t("复盘")}
          </div>
          <div className="summary-kpi-strip">
            <Metric label={t("新增")} value={data.todayCreated.length} />
            <Metric label={t("完成")} value={data.todayDone.length} />
            <Metric label={t("未完成")} value={data.openTodos.length} />
            <Metric label={t("完成率")} value={data.completionRate} suffix="%" />
            <Metric label={t("计划兑现率")} value={data.scheduleCompletionRate} suffix="%" />
          </div>
          <div className="summary-ai-review">
            <div className="summary-card-title">
              <Sparkles size={17} />
              {t("今日复盘")}
              <button className="summary-generate-button" onClick={onGenerateSummary} disabled={summaryBusy}>
                {summaryBusy ? t("生成中...") : t("生成/刷新")}
              </button>
            </div>
            {summaryError && <div className="summary-error">{summaryError}</div>}
            {summaryText ? (
              <p className="summary-text">{summaryText}</p>
            ) : (
              <div className="summary-empty">{t("模板：今天完成了什么、哪些计划没兑现、明天最重要的三件事。")}</div>
            )}
          </div>
        </section>
      </div>

      <aside className="summary-risk-inbox">
        <div className="summary-card-title">
          <AlertTriangle size={17} />
          {t("风险收件箱")}
        </div>
        {data.risks.length === 0 ? (
          <div className="summary-empty">{t("暂无高风险任务。")}</div>
        ) : (
          data.risks.slice(0, 5).map((risk) => (
            <div key={`${risk.type}-${risk.todo.id}`} className="summary-risk-item">
              <strong>{risk.todo.title}</strong>
              <span>{t(risk.label)}</span>
              {formatSummaryRiskTime(risk.todo, locale, t) && <small>{formatSummaryRiskTime(risk.todo, locale, t)}</small>}
              <div>
                <button type="button" onClick={() => scheduleToday(risk.todo)}>{t("安排到今天")}</button>
                <button type="button" onClick={() => postponeTomorrow(risk.todo)}>{t("延后")}</button>
                <button type="button" onClick={() => onToggleTodo(risk.todo)}>{t("完成")}</button>
              </div>
            </div>
          ))
        )}
      </aside>
    </section>
  );
}
