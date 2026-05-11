import React from "react";
import { Paperclip, Search, Send } from "lucide-react";
import type { TodoItem, TodoPriority } from "../../../shared/types";
import { startOfDay, startOfWeek, startOfMonth, formatCalendarRange, formatDateKey } from "../../utils/dateHelpers";
import { formatRelativeTodoTime } from "../../utils/formatHelpers";
import { compareTodosForWork, getTodoTargetTime } from "../../utils/todoHelpers";
import { formatPriority } from "../../utils/formatHelpers";
import { isOverdueOpenTodo } from "../../utils/petHelpers";
import { CalendarTimeCanvas, CalendarMonthCanvas } from "./CalendarCanvases";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { useI18n } from "../../i18n";

export function CalendarPanel({
  todos,
  onToggle,
  onUpdate,
  onDelete,
  onQuickAdd
}: {
  todos: TodoItem[];
  onToggle(todo: TodoItem): void;
  onUpdate(todo: TodoItem, patch: Partial<Pick<TodoItem, "title" | "notes" | "project" | "tags" | "priority" | "status" | "remindAt" | "dueAt" | "scheduledStartAt" | "scheduledEndAt" | "isAllDayScheduled" | "subtasks" | "attachments" | "completedAt">>): void;
  onDelete(todo: TodoItem): void;
  onQuickAdd(text: string): void;
}) {
  const { t, locale } = useI18n();
  type CalendarView = "day" | "week" | "month";
  const [currentTime, setCurrentTime] = React.useState(() => new Date());
  const [view, setView] = React.useState<CalendarView>("week");
  const [anchorDate, setAnchorDate] = React.useState(() => startOfDay(new Date()));
  const [selectedTodoId, setSelectedTodoId] = React.useState<string | null>(null);
  const [searchText, setSearchText] = React.useState("");
  const [priorityFilter, setPriorityFilter] = React.useState<TodoPriority | "all">("all");
  const [quickText, setQuickText] = React.useState("");

  React.useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const weekStart = React.useMemo(() => startOfWeek(anchorDate), [anchorDate]);
  const visibleDays = React.useMemo(() => {
    const dayCount = view === "day" ? 1 : 7;
    const start = view === "day" ? startOfDay(anchorDate) : weekStart;
    return Array.from({ length: dayCount }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  }, [anchorDate, view, weekStart]);
  const filteredTodos = React.useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return todos.filter((todo) => {
      if (priorityFilter !== "all" && todo.priority !== priorityFilter) return false;
      if (!normalizedSearch) return true;
      const haystack = [todo.title, todo.notes, todo.project, ...(todo.tags ?? [])].join(" ").toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [priorityFilter, searchText, todos]);
  const backlogTodos = React.useMemo(() => filteredTodos
    .filter((todo) => todo.status === "open" && !todo.scheduledStartAt)
    .sort(compareTodosForWork), [filteredTodos]);
  const selectedTodo = todos.find((todo) => todo.id === selectedTodoId) ?? null;
  const rangeTitle = formatCalendarRange(view, anchorDate, visibleDays, locale);
  const calendarDataVersion = React.useMemo(
    () => todos.map((todo) => [
      todo.id,
      todo.status,
      todo.dueAt,
      todo.remindAt,
      todo.scheduledStartAt,
      todo.scheduledEndAt,
      todo.isAllDayScheduled
    ].join(":")).join("|"),
    [todos]
  );

  function moveRange(delta: number) {
    if (view === "month") {
      setAnchorDate((date) => startOfMonth(new Date(date.getFullYear(), date.getMonth() + delta, 1)));
      return;
    }
    const days = view === "day" ? 1 : 7;
    setAnchorDate((date) => startOfDay(new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta * days)));
  }

  function submitQuickAdd(event: React.FormEvent) {
    event.preventDefault();
    const text = quickText.trim();
    if (!text) return;
    onQuickAdd(text);
    setQuickText("");
  }

  function scheduleTodo(todo: TodoItem, day: Date, hour = 9, allDay = false) {
    const start = new Date(day);
    start.setHours(allDay ? 0 : hour, 0, 0, 0);
    const end = new Date(start);
    end.setMinutes(end.getMinutes() + (allDay ? 24 * 60 - 1 : 60));
    scheduleTodoRange(todo, start, end, allDay);
  }

  function scheduleTodoRange(todo: TodoItem, start: Date, end: Date, allDay = false) {
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;
    const safeEnd = end.getTime() > start.getTime() ? end : new Date(start.getTime() + 15 * 60_000);
    onUpdate(todo, {
      scheduledStartAt: start.toISOString(),
      scheduledEndAt: safeEnd.toISOString(),
      isAllDayScheduled: allDay
    });
    setSelectedTodoId(todo.id);
  }

  function unscheduleTodo(todo: TodoItem) {
    onUpdate(todo, {
      scheduledStartAt: null as unknown as undefined,
      scheduledEndAt: null as unknown as undefined,
      isAllDayScheduled: false
    });
  }

  return (
    <section className="calendar-page">
      <div className="calendar-toolbar">
        <div className="calendar-range-controls">
          <button type="button" onClick={() => setAnchorDate(startOfDay(new Date()))}>{t("今天")}</button>
          <button type="button" onClick={() => moveRange(-1)} aria-label={t("上一段")}>‹</button>
          <strong>{rangeTitle}</strong>
          <button type="button" onClick={() => moveRange(1)} aria-label={t("下一段")}>›</button>
        </div>
        <div className="calendar-view-switch">
          {(["day", "week", "month"] as CalendarView[]).map((item) => (
            <button key={item} type="button" className={view === item ? "active" : ""} onClick={() => setView(item)}>
              {item === "day" ? t("日") : item === "week" ? t("周") : t("月")}
            </button>
          ))}
        </div>
        <label className="calendar-search">
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
        <form className="calendar-quick-add" onSubmit={submitQuickAdd}>
          <input value={quickText} onChange={(event) => setQuickText(event.target.value)} placeholder={t("新建任务：@项目 #标签 !P0")} />
          <button type="submit"><Send size={14} /></button>
        </form>
      </div>

      <aside className="calendar-backlog">
        <div className="calendar-backlog-header">
          <strong>{t("任务池")}</strong>
          <span>{currentTime.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        <section>
          <div className="calendar-pool-title">{t("智能队列")}</div>
          <div className="calendar-quick-picks">
            <span>{t("逾期 {count}", { count: backlogTodos.filter((todo) => isOverdueOpenTodo(todo, Date.now())).length })}</span>
            <span>24h {backlogTodos.filter((todo) => {
              const time = getTodoTargetTime(todo);
              return typeof time === "number" && time <= Date.now() + 24 * 60 * 60_000;
            }).length}</span>
            <span>P0 {backlogTodos.filter((todo) => todo.priority === "urgent").length}</span>
          </div>
        </section>
        <section>
          <div className="calendar-pool-title">{t("待安排")}</div>
          <div className="calendar-backlog-list">
            {backlogTodos.length === 0 && <div className="calendar-empty">{t("没有待安排任务。")}</div>}
            {backlogTodos.map((todo) => (
              <button
                key={todo.id}
                type="button"
                className={`calendar-backlog-task ${selectedTodoId === todo.id ? "selected" : ""}`}
                draggable
                onDragStart={(event) => event.dataTransfer.setData("text/plain", todo.id)}
                onClick={() => setSelectedTodoId(todo.id)}
              >
                <strong>{todo.title}</strong>
                <span>
                  <small className={`priority-chip priority-${todo.priority ?? "medium"}`}>{formatPriority(todo.priority)}</small>
                  {todo.dueAt && <small>{t("截止 {time}", { time: formatRelativeTodoTime(todo) })}</small>}
                  {todo.project && <small>@{todo.project}</small>}
                  {!!todo.subtasks?.length && <small>{t("{count} 子任务", { count: todo.subtasks.length })}</small>}
                  {!!todo.attachments?.length && <Paperclip size={12} />}
                </span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className={`calendar-canvas ${view}`}>
        {view === "month" ? (
          <CalendarMonthCanvas
            key={`${formatDateKey(startOfMonth(anchorDate))}-${calendarDataVersion}`}
            anchorDate={anchorDate}
            todos={filteredTodos}
            now={currentTime.getTime()}
            selectedTodoId={selectedTodoId}
            onSelectTodo={setSelectedTodoId}
            onSelectDate={(date) => {
              setAnchorDate(date);
              setView("day");
            }}
          />
        ) : (
          <CalendarTimeCanvas
            days={visibleDays}
            todos={filteredTodos}
            now={currentTime.getTime()}
            selectedTodoId={selectedTodoId}
            onSelectTodo={setSelectedTodoId}
            onSchedule={scheduleTodo}
            onScheduleRange={scheduleTodoRange}
            onUnschedule={unscheduleTodo}
          />
        )}
      </section>

      <TaskDetailPanel
        todo={selectedTodo}
        onSave={(todo, patch) => onUpdate(todo, patch)}
        onDelete={(todo) => onDelete(todo)}
      />
    </section>
  );
}
