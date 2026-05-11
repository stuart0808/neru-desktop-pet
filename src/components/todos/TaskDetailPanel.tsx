import React from "react";
import { ListTodo, Save, Trash2 } from "lucide-react";
import type { TodoItem, TodoPriority } from "../../../shared/types";
import { splitDraftList } from "../../utils/todoHelpers";
import { toDatetimeLocalValue, fromDatetimeLocalValue } from "../../utils/dateHelpers";
import { useI18n } from "../../i18n";

export function TaskDetailPanel({
  todo,
  onSave,
  onDelete
}: {
  todo: TodoItem | null;
  onSave(todo: TodoItem, patch: Partial<Pick<TodoItem, "title" | "notes" | "project" | "tags" | "priority" | "status" | "remindAt" | "dueAt" | "scheduledStartAt" | "scheduledEndAt" | "isAllDayScheduled" | "subtasks" | "attachments" | "completedAt">>): void;
  onDelete(todo: TodoItem): void;
}) {
  const { t, locale } = useI18n();
  const [title, setTitle] = React.useState("");
  const [status, setStatus] = React.useState<TodoItem["status"]>("open");
  const [project, setProject] = React.useState("");
  const [priority, setPriority] = React.useState<TodoPriority>("medium");
  const [tags, setTags] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [remindAt, setRemindAt] = React.useState("");
  const [scheduledStartAt, setScheduledStartAt] = React.useState("");
  const [scheduledEndAt, setScheduledEndAt] = React.useState("");
  const [isAllDayScheduled, setIsAllDayScheduled] = React.useState(false);
  const [subtasks, setSubtasks] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [attachments, setAttachments] = React.useState("");

  React.useEffect(() => {
    setTitle(todo?.title ?? "");
    setStatus(todo?.status ?? "open");
    setProject(todo?.project ?? "");
    setPriority(todo?.priority ?? "medium");
    setTags((todo?.tags ?? []).join(", "));
    setDueAt(toDatetimeLocalValue(todo?.dueAt));
    setRemindAt(toDatetimeLocalValue(todo?.remindAt));
    setScheduledStartAt(toDatetimeLocalValue(todo?.scheduledStartAt));
    setScheduledEndAt(toDatetimeLocalValue(todo?.scheduledEndAt));
    setIsAllDayScheduled(todo?.isAllDayScheduled === true);
    setSubtasks((todo?.subtasks ?? []).map((subtask) => subtask.title).join("\n"));
    setNotes(todo?.notes ?? "");
    setAttachments((todo?.attachments ?? []).join("\n"));
  }, [todo]);

  function save() {
    if (!todo) return;
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    onSave(todo, {
      title: normalizedTitle,
      status,
      completedAt: status === "done" ? (todo.completedAt ?? new Date().toISOString()) : undefined,
      project: project.trim() || undefined,
      priority,
      tags: splitDraftList(tags),
      dueAt: fromDatetimeLocalValue(dueAt),
      remindAt: fromDatetimeLocalValue(remindAt),
      scheduledStartAt: fromDatetimeLocalValue(scheduledStartAt),
      scheduledEndAt: fromDatetimeLocalValue(scheduledEndAt),
      isAllDayScheduled,
      subtasks: splitDraftList(subtasks).map((item, index) => ({
        id: todo.subtasks?.[index]?.id,
        title: item,
        done: todo.subtasks?.[index]?.done === true
      })),
      notes: notes.trim() || undefined,
      attachments: splitDraftList(attachments)
    });
  }

  if (!todo) {
    return (
      <aside className="todo-detail-panel empty-detail">
        <ListTodo size={24} />
        <strong>{t("选择一个任务")}</strong>
        <span>{t("在中间列表选择任务后，可以在这里修改所有属性。")}</span>
      </aside>
    );
  }

  return (
    <aside className="todo-detail-panel">
      <div className="todo-detail-header">
        <div>
          <strong>{t("任务详情")}</strong>
          <span>{todo.confirmedAt ? t("确认于 {time}", { time: new Date(todo.confirmedAt).toLocaleString(locale) }) : t("创建于 {time}", { time: new Date(todo.createdAt).toLocaleString(locale) })}</span>
        </div>
        <button type="button" onClick={save}>
          <Save size={14} /> {t("保存")}
        </button>
      </div>
      <label>
        {t("内容")}
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <div className="task-pane-grid">
        <label>
          {t("状态")}
          <select value={status} onChange={(event) => setStatus(event.target.value as TodoItem["status"])}>
            <option value="open">{t("未完成")}</option>
            <option value="done">{t("已完成")}</option>
            <option value="dismissed">{t("已丢弃")}</option>
          </select>
        </label>
        <label>
          {t("优先级")}
          <select value={priority} onChange={(event) => setPriority(event.target.value as TodoPriority)}>
            <option value="urgent">{t("P0 紧急")}</option>
            <option value="high">{t("P1 高")}</option>
            <option value="medium">{t("P2 中")}</option>
            <option value="low">{t("P3 低")}</option>
          </select>
        </label>
      </div>
      <div className="task-pane-grid">
        <label>
          {t("截止")}
          <input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} />
        </label>
        <label>
          {t("提醒")}
          <input type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} />
        </label>
      </div>
      <div className="calendar-detail-schedule">
        <strong>{t("计划块")}</strong>
        <label className="calendar-all-day-toggle">
          <input type="checkbox" checked={isAllDayScheduled} onChange={(event) => setIsAllDayScheduled(event.target.checked)} />
          {t("全天安排")}
        </label>
        <div className="task-pane-grid">
          <label>
            {t("开始")}
            <input type="datetime-local" value={scheduledStartAt} onChange={(event) => setScheduledStartAt(event.target.value)} />
          </label>
          <label>
            {t("结束")}
            <input type="datetime-local" value={scheduledEndAt} onChange={(event) => setScheduledEndAt(event.target.value)} />
          </label>
        </div>
        <button type="button" onClick={() => {
          setScheduledStartAt("");
          setScheduledEndAt("");
          setIsAllDayScheduled(false);
          onSave(todo, {
            scheduledStartAt: undefined,
            scheduledEndAt: undefined,
            isAllDayScheduled: false
          });
        }}>{t("移回任务池")}</button>
      </div>
      <label>
        {t("项目")}
        <input value={project} onChange={(event) => setProject(event.target.value)} />
      </label>
      <label>
        {t("标签")}
        <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={t("用逗号分隔")} />
      </label>
      <label>
        {t("子任务")}
        <textarea value={subtasks} onChange={(event) => setSubtasks(event.target.value)} rows={4} placeholder={t("每行一个子任务")} />
      </label>
      <label>
        {t("备注")}
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={4} />
      </label>
      <label>
        {t("附件")}
        <textarea value={attachments} onChange={(event) => setAttachments(event.target.value)} rows={2} placeholder={t("每行一个附件名称或路径")} />
      </label>
      <div className="todo-detail-log">
        <span>{t("创建：{time}", { time: new Date(todo.createdAt).toLocaleString(locale) })}</span>
        {todo.sourceMessage && <span>{t("来源：{source}", { source: todo.sourceMessage })}</span>}
      </div>
      <button type="button" className="todo-detail-delete" onClick={() => onDelete(todo)}>
        <Trash2 size={14} /> {t("删除任务")}
      </button>
    </aside>
  );
}
