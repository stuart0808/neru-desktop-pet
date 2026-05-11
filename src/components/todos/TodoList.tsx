import React from "react";
import { AlertTriangle, CalendarDays, Check, Clock, FileText, FolderOpen, Inbox, ListTodo, Paperclip, Search, Send, Tag } from "lucide-react";
import type { TodoItem, TodoPriority } from "../../../shared/types";
import { startOfDay } from "../../utils/dateHelpers";
import { getTodoTargetTime, compareTodosForWork, groupTodosForDisplay } from "../../utils/todoHelpers";
import { formatPriority, formatRelativeTodoTime } from "../../utils/formatHelpers";
import { TaskDetailPanel } from "./TaskDetailPanel";
import { useI18n } from "../../i18n";

export function TodoList({
  todos,
  focusedTodoId,
  onToggle,
  onUpdate,
  onDelete,
  onQuickAdd
}: {
  todos: TodoItem[];
  focusedTodoId?: string | null;
  onToggle(todo: TodoItem): void;
  onUpdate(todo: TodoItem, patch: Partial<Pick<TodoItem, "title" | "notes" | "project" | "tags" | "priority" | "status" | "remindAt" | "dueAt" | "scheduledStartAt" | "scheduledEndAt" | "isAllDayScheduled" | "subtasks" | "attachments" | "completedAt">>): void;
  onDelete(todo: TodoItem): void;
  onQuickAdd(text: string): void;
}) {
  const { t } = useI18n();
  type TodoScope = "inbox" | "today" | "next7" | "overdue" | "all" | "done";
  type TodoViewMode = "list" | "grouped" | "compact";
  const [scope, setScope] = React.useState<TodoScope>("inbox");
  const [viewMode, setViewMode] = React.useState<TodoViewMode>("list");
  const [selectedTodoId, setSelectedTodoId] = React.useState<string | null>(focusedTodoId ?? null);
  const [selectedProject, setSelectedProject] = React.useState<string | null>(null);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = React.useState<TodoPriority | "all">("all");
  const [searchText, setSearchText] = React.useState("");
  const [quickText, setQuickText] = React.useState("");
  const now = Date.now();
  const todayStart = startOfDay(new Date()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60_000;
  const nextWeekEnd = todayStart + 8 * 24 * 60 * 60_000;
  const openTodos = todos.filter((todo) => todo.status === "open");
  const doneTodos = todos.filter((todo) => todo.status === "done");
  const projects = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const todo of openTodos) {
      if (!todo.project) continue;
      counts.set(todo.project, (counts.get(todo.project) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [openTodos]);
  const tags = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const todo of openTodos) {
      for (const tagName of todo.tags ?? []) counts.set(tagName, (counts.get(tagName) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [openTodos]);
  const visibleTodos = React.useMemo(() => {
    const normalizedSearch = searchText.trim().toLowerCase();
    return todos
      .filter((todo) => {
        const targetTime = getTodoTargetTime(todo);
        if (scope === "inbox" && (todo.status !== "open" || todo.project)) return false;
        if (scope === "today" && (todo.status !== "open" || typeof targetTime !== "number" || targetTime < todayStart || targetTime >= tomorrowStart)) return false;
        if (scope === "next7" && (todo.status !== "open" || typeof targetTime !== "number" || targetTime < tomorrowStart || targetTime >= nextWeekEnd)) return false;
        if (scope === "overdue" && (todo.status !== "open" || typeof targetTime !== "number" || targetTime > now)) return false;
        if (scope === "all" && todo.status !== "open") return false;
        if (scope === "done" && todo.status !== "done") return false;
        if (selectedProject && todo.project !== selectedProject) return false;
        if (selectedTags.length && !selectedTags.every((tagName) => todo.tags?.includes(tagName))) return false;
        if (priorityFilter !== "all" && todo.priority !== priorityFilter) return false;
        if (normalizedSearch) {
          const haystack = [todo.title, todo.notes, todo.project, ...(todo.tags ?? [])].join(" ").toLowerCase();
          if (!haystack.includes(normalizedSearch)) return false;
        }
        return true;
      })
      .sort(compareTodosForWork);
  }, [nextWeekEnd, now, priorityFilter, scope, searchText, selectedProject, selectedTags, todayStart, todos, tomorrowStart]);
  const selectedTodo = todos.find((todo) => todo.id === selectedTodoId) ?? visibleTodos[0] ?? null;
  const scopeItems: Array<{ id: TodoScope; label: string; count: number; icon: React.ReactNode }> = [
    { id: "inbox", label: t("收件箱"), count: openTodos.filter((todo) => !todo.project).length, icon: <Inbox size={15} /> },
    { id: "today", label: t("今天"), count: openTodos.filter((todo) => {
      const time = getTodoTargetTime(todo);
      return typeof time === "number" && time >= todayStart && time < tomorrowStart;
    }).length, icon: <Clock size={15} /> },
    { id: "next7", label: t("接下来 7 天"), count: openTodos.filter((todo) => {
      const time = getTodoTargetTime(todo);
      return typeof time === "number" && time >= tomorrowStart && time < nextWeekEnd;
    }).length, icon: <CalendarDays size={15} /> },
    { id: "overdue", label: t("逾期"), count: openTodos.filter((todo) => {
      const time = getTodoTargetTime(todo);
      return typeof time === "number" && time <= now;
    }).length, icon: <AlertTriangle size={15} /> },
    { id: "all", label: t("全部"), count: openTodos.length, icon: <ListTodo size={15} /> },
    { id: "done", label: t("已完成"), count: doneTodos.length, icon: <Check size={15} /> }
  ];

  React.useEffect(() => {
    if (focusedTodoId) setSelectedTodoId(focusedTodoId);
  }, [focusedTodoId]);

  React.useEffect(() => {
    if (selectedTodoId && todos.some((todo) => todo.id === selectedTodoId)) return;
    setSelectedTodoId(visibleTodos[0]?.id ?? null);
  }, [selectedTodoId, todos, visibleTodos]);

  function submitQuickAdd(event: React.FormEvent) {
    event.preventDefault();
    const text = quickText.trim();
    if (!text) return;
    onQuickAdd(text);
    setQuickText("");
  }

  function toggleTagFilter(tagName: string) {
    setSelectedTags((current) =>
      current.includes(tagName) ? current.filter((item) => item !== tagName) : [...current, tagName]
    );
  }

  function clearFilters() {
    setSelectedProject(null);
    setSelectedTags([]);
    setPriorityFilter("all");
    setSearchText("");
  }

  function renderTodoRow(todo: TodoItem) {
    const selected = selectedTodo?.id === todo.id;
    return (
      <button
        key={todo.id}
        type="button"
        data-todo-id={todo.id}
        className={`todo-work-row ${todo.status} ${selected ? "selected" : ""} ${viewMode === "compact" ? "compact" : ""}`}
        onClick={() => setSelectedTodoId(todo.id)}
      >
        <span
          className="check"
          role="checkbox"
          aria-checked={todo.status === "done"}
          onClick={(event) => {
            event.stopPropagation();
            onToggle(todo);
          }}
        >
          {todo.status === "done" ? <Check size={14} /> : null}
        </span>
        <span className="todo-work-main">
          <strong>{todo.title}</strong>
          {viewMode !== "compact" && (
            <span className="todo-work-meta">
              <small className={`priority-chip priority-${todo.priority ?? "medium"}`}>{formatPriority(todo.priority)}</small>
              {todo.project && <small>@{todo.project}</small>}
              {(todo.dueAt || todo.remindAt) && <small>{formatRelativeTodoTime(todo)}</small>}
              {!!todo.subtasks?.length && <small>{t("{done}/{total} 子任务", { done: todo.subtasks.filter((subtask) => subtask.done).length, total: todo.subtasks.length })}</small>}
              {!!todo.attachments?.length && <small><Paperclip size={11} /> {todo.attachments.length}</small>}
              {!!todo.notes && <small><FileText size={11} /> {t("备注")}</small>}
            </span>
          )}
        </span>
        {viewMode !== "compact" && (
          <span className="todo-work-tags">
            {(todo.tags ?? []).slice(0, 2).map((tagName) => <small key={tagName}>#{tagName}</small>)}
          </span>
        )}
      </button>
    );
  }

  const groupedTodos = groupTodosForDisplay(visibleTodos);

  return (
    <section className="todo-workspace">
      <aside className="todo-scope-panel">
        <div className="todo-scope-section">
          <strong>{t("范围")}</strong>
          {scopeItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`todo-scope-button ${scope === item.id ? "active" : ""}`}
              onClick={() => setScope(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
              <small>{item.count}</small>
            </button>
          ))}
        </div>
        <div className="todo-scope-section">
          <strong>{t("项目")}</strong>
          {projects.length === 0 && <span className="todo-filter-empty">{t("暂无项目")}</span>}
          {projects.map(([project, count]) => (
            <button
              key={project}
              type="button"
              className={`todo-scope-button ${selectedProject === project ? "active" : ""}`}
              onClick={() => setSelectedProject(selectedProject === project ? null : project)}
            >
              <FolderOpen size={15} />
              <span>{project}</span>
              <small>{count}</small>
            </button>
          ))}
        </div>
        <div className="todo-scope-section">
          <strong>{t("标签")}</strong>
          <div className="todo-tag-filter">
            {tags.slice(0, 12).map(([tagName, count]) => (
              <button
                key={tagName}
                type="button"
                className={selectedTags.includes(tagName) ? "active" : ""}
                onClick={() => toggleTagFilter(tagName)}
              >
                <Tag size={12} /> {tagName} <small>{count}</small>
              </button>
            ))}
            {tags.length === 0 && <span className="todo-filter-empty">{t("暂无标签")}</span>}
          </div>
        </div>
        <div className="todo-scope-section">
          <strong>{t("过滤")}</strong>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as TodoPriority | "all")}>
            <option value="all">{t("全部优先级")}</option>
            <option value="urgent">{t("P0 紧急")}</option>
            <option value="high">{t("P1 高")}</option>
            <option value="medium">{t("P2 中")}</option>
            <option value="low">{t("P3 低")}</option>
          </select>
          <button type="button" className="todo-clear-filter" onClick={clearFilters}>{t("清除过滤")}</button>
        </div>
      </aside>

      <section className="todo-list-panel">
        <div className="todo-list-toolbar">
          <form className="todo-quick-add" onSubmit={submitQuickAdd}>
            <input
              value={quickText}
              onChange={(event) => setQuickText(event.target.value)}
              placeholder={t("快速添加：明天 5 点 #标签 @项目 !P0")}
            />
            <button type="submit"><Send size={14} /></button>
          </form>
          <label className="todo-search">
            <Search size={14} />
            <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder={t("搜索任务")} />
          </label>
          <div className="todo-view-switch" aria-label={t("待办视图")}>
            <button type="button" className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}>{t("列表")}</button>
            <button type="button" className={viewMode === "grouped" ? "active" : ""} onClick={() => setViewMode("grouped")}>{t("分组")}</button>
            <button type="button" className={viewMode === "compact" ? "active" : ""} onClick={() => setViewMode("compact")}>{t("紧凑")}</button>
          </div>
        </div>
        <div className={`todo-work-list ${viewMode}`}>
          {visibleTodos.length === 0 && <div className="empty">{t("当前范围没有任务。")}</div>}
          {viewMode === "grouped"
            ? groupedTodos.map((group) => (
                <section key={group.title} className="todo-group">
                  <div className="todo-group-title">{group.title}<span>{group.items.length}</span></div>
                  {group.items.map(renderTodoRow)}
                </section>
              ))
            : visibleTodos.map(renderTodoRow)}
        </div>
      </section>

      <TaskDetailPanel
        todo={selectedTodo}
        onSave={(todo, patch) => onUpdate(todo, patch)}
        onDelete={(todo) => onDelete(todo)}
      />
    </section>
  );
}
