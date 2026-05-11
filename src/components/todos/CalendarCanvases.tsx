import React from "react";
import type { TodoItem } from "../../../shared/types";
import { formatDateKey, formatScheduledTime, isSameDay, getCalendarMonthDays, startOfMonth } from "../../utils/dateHelpers";
import { compareTodosForWork, getTodoTargetTime } from "../../utils/todoHelpers";
import { getCalendarDisplayDate } from "../../utils/dateHelpers";
import { useI18n } from "../../i18n";

const DAY_START_HOUR = 8;
const DAY_END_HOUR = 22;
const HOUR_HEIGHT = 58;
const SNAP_MINUTES = 15;
const MIN_TIMED_DURATION_MINUTES = 15;
const DEFAULT_TIMED_DURATION_MINUTES = 60;

function getTodoTime(value: string | undefined) {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapMinutes(value: number) {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

function getMinutesInDay(date: Date) {
  return date.getHours() * 60 + date.getMinutes();
}

function makeScheduledDate(day: Date, minutesInDay: number) {
  const date = new Date(day);
  date.setHours(Math.floor(minutesInDay / 60), minutesInDay % 60, 0, 0);
  return date;
}

function getTodoDurationMinutes(todo: TodoItem) {
  if (todo.isAllDayScheduled) return DEFAULT_TIMED_DURATION_MINUTES;
  const start = getTodoTime(todo.scheduledStartAt);
  const end = getTodoTime(todo.scheduledEndAt);
  if (typeof start !== "number" || typeof end !== "number" || end <= start) return DEFAULT_TIMED_DURATION_MINUTES;
  return clamp(Math.round((end - start) / 60_000), MIN_TIMED_DURATION_MINUTES, (DAY_END_HOUR - DAY_START_HOUR) * 60);
}

function getPointerMinutes(event: React.DragEvent | PointerEvent, container: HTMLElement) {
  const rect = container.getBoundingClientRect();
  const minutesFromStart = snapMinutes(((event.clientY - rect.top) / HOUR_HEIGHT) * 60);
  return clamp(DAY_START_HOUR * 60 + minutesFromStart, DAY_START_HOUR * 60, DAY_END_HOUR * 60);
}

function getTimedBounds(todo: TodoItem) {
  const start = todo.scheduledStartAt ? new Date(todo.scheduledStartAt) : null;
  if (!start || !Number.isFinite(start.getTime())) return null;
  const rawEnd = todo.scheduledEndAt ? new Date(todo.scheduledEndAt) : null;
  const end = rawEnd && Number.isFinite(rawEnd.getTime()) && rawEnd > start
    ? rawEnd
    : new Date(start.getTime() + DEFAULT_TIMED_DURATION_MINUTES * 60_000);
  return { start, end };
}

function getTimedLayout(todos: TodoItem[]) {
  const entries = todos
    .map((todo) => {
      const bounds = getTimedBounds(todo);
      if (!bounds) return null;
      return {
        todo,
        start: getMinutesInDay(bounds.start),
        end: Math.max(getMinutesInDay(bounds.end), getMinutesInDay(bounds.start) + MIN_TIMED_DURATION_MINUTES)
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const layout = new Map<string, { lane: number; lanes: number }>();
  let cluster: typeof entries = [];
  let clusterEnd = -1;

  function flushCluster() {
    const laneEnds: number[] = [];
    for (const entry of cluster) {
      let lane = laneEnds.findIndex((end) => end <= entry.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = entry.end;
      layout.set(entry.todo.id, { lane, lanes: 1 });
    }
    for (const entry of cluster) {
      const current = layout.get(entry.todo.id);
      if (current) current.lanes = Math.max(1, laneEnds.length);
    }
    cluster = [];
    clusterEnd = -1;
  }

  for (const entry of entries) {
    if (cluster.length && entry.start >= clusterEnd) flushCluster();
    cluster.push(entry);
    clusterEnd = Math.max(clusterEnd, entry.end);
  }
  if (cluster.length) flushCluster();
  return layout;
}

function getCalendarRisk(todo: TodoItem, now: number) {
  if (todo.status !== "open") return "";
  const due = getTodoTime(todo.dueAt);
  const remind = getTodoTime(todo.remindAt);
  const scheduledStart = getTodoTime(todo.scheduledStartAt);
  const scheduledEnd = getTodoTime(todo.scheduledEndAt) ?? scheduledStart;
  if (typeof due === "number" && ((typeof scheduledStart === "number" && scheduledStart > due) || (typeof scheduledEnd === "number" && scheduledEnd > due))) {
    return "计划晚于截止";
  }
  const target = scheduledEnd ?? due ?? remind;
  if (typeof target === "number" && target <= now) return "已超过当前时间";
  return "";
}

function getCalendarMonthTodoClass(todo: TodoItem, now: number) {
  const classes = ["calendar-month-todo"];
  if (todo.status === "done") classes.push("done");
  else if (getCalendarRisk(todo, now)) classes.push("risk");
  else if (todo.scheduledStartAt) classes.push("scheduled");
  else classes.push("open");
  return classes.join(" ");
}

export function CalendarBlock({
  todo,
  now,
  selected,
  onSelect,
  onUnschedule,
  draggable,
  style,
  onDragStart,
  onResizeStart
}: {
  todo: TodoItem;
  now: number;
  selected: boolean;
  onSelect(id: string): void;
  onUnschedule(todo: TodoItem): void;
  draggable?: boolean;
  style?: React.CSSProperties;
  onDragStart?(event: React.DragEvent, todo: TodoItem): void;
  onResizeStart?(event: React.PointerEvent, todo: TodoItem): void;
}) {
  const { t } = useI18n();
  const risk = getCalendarRisk(todo, now);
  return (
    <button
      type="button"
      className={`calendar-block priority-${todo.priority ?? "medium"} ${risk ? "risk" : ""} ${todo.status === "done" ? "done" : ""} ${selected ? "selected" : ""}`}
      draggable={draggable}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(todo.id);
      }}
      onDragStart={(event) => onDragStart?.(event, todo)}
    >
      {risk && <b className="calendar-risk-mark" aria-label={t(risk)}>!</b>}
      <strong>{todo.title}</strong>
      <span>{todo.isAllDayScheduled ? t("全天") : formatScheduledTime(todo)}</span>
      <i
        role="button"
        tabIndex={0}
        aria-label={t("移回任务池")}
        onClick={(event) => {
          event.stopPropagation();
          onUnschedule(todo);
        }}
      >
        ×
      </i>
      {onResizeStart && (
        <span
          className="calendar-resize-handle"
          title={t("拖动调整时长")}
          aria-hidden="true"
          onPointerDown={(event) => onResizeStart(event, todo)}
        />
      )}
    </button>
  );
}

export function CalendarTimeCanvas({
  days,
  todos,
  now,
  selectedTodoId,
  onSelectTodo,
  onSchedule,
  onScheduleRange,
  onUnschedule
}: {
  days: Date[];
  todos: TodoItem[];
  now: number;
  selectedTodoId: string | null;
  onSelectTodo(id: string): void;
  onSchedule(todo: TodoItem, day: Date, hour?: number, allDay?: boolean): void;
  onScheduleRange(todo: TodoItem, start: Date, end: Date, allDay?: boolean): void;
  onUnschedule(todo: TodoItem): void;
}) {
  const { t, locale } = useI18n();
  const hours = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, index) => index + DAY_START_HOUR);
  const scheduledTodos = todos.filter((todo) => todo.scheduledStartAt);
  const [resizeDraft, setResizeDraft] = React.useState<{ todoId: string; end: Date } | null>(null);

  function readDraggedTodo(event: React.DragEvent) {
    const id = event.dataTransfer.getData("text/plain");
    return todos.find((todo) => todo.id === id);
  }

  function scheduleDrop(event: React.DragEvent, day: Date) {
    event.preventDefault();
    const todo = readDraggedTodo(event);
    if (!todo) return;
    const container = event.currentTarget as HTMLElement;
    const duration = getTodoDurationMinutes(todo);
    const latestStart = Math.max(DAY_START_HOUR * 60, DAY_END_HOUR * 60 - duration);
    const startMinutes = clamp(getPointerMinutes(event, container), DAY_START_HOUR * 60, latestStart);
    const start = makeScheduledDate(day, startMinutes);
    const end = makeScheduledDate(day, startMinutes + duration);
    onScheduleRange(todo, start, end, false);
  }

  function dragScheduledTodo(event: React.DragEvent, todo: TodoItem) {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", todo.id);
  }

  function startResize(event: React.PointerEvent, todo: TodoItem) {
    event.preventDefault();
    event.stopPropagation();
    const column = (event.currentTarget as HTMLElement).closest(".calendar-day-column") as HTMLElement | null;
    const bounds = getTimedBounds(todo);
    if (!column || !bounds) return;
    const startMinutes = getMinutesInDay(bounds.start);
    const day = new Date(bounds.start);
    const pointerId = event.pointerId;
    (event.currentTarget as HTMLElement).setPointerCapture?.(pointerId);

    const move = (moveEvent: PointerEvent) => {
      const endMinutes = clamp(getPointerMinutes(moveEvent, column), startMinutes + MIN_TIMED_DURATION_MINUTES, DAY_END_HOUR * 60);
      setResizeDraft({ todoId: todo.id, end: makeScheduledDate(day, endMinutes) });
    };
    const up = (upEvent: PointerEvent) => {
      const endMinutes = clamp(getPointerMinutes(upEvent, column), startMinutes + MIN_TIMED_DURATION_MINUTES, DAY_END_HOUR * 60);
      const end = makeScheduledDate(day, endMinutes);
      setResizeDraft(null);
      onScheduleRange(todo, bounds.start, end, false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  }

  return (
    <div className="calendar-time-canvas">
      <div className="calendar-time-head-spacer" />
      {days.map((day) => (
        <div key={formatDateKey(day)} className="calendar-day-heading">
          <strong>{day.toLocaleDateString(locale, { weekday: "short" })}</strong>
          <span>{day.toLocaleDateString(locale, { month: "2-digit", day: "2-digit" })}</span>
        </div>
      ))}
      <div className="calendar-all-day-label">{t("全天")}</div>
      {days.map((day) => (
        <div
          key={`${formatDateKey(day)}-all`}
          className="calendar-all-day-cell"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            const todo = readDraggedTodo(event);
            if (todo) onSchedule(todo, day, 0, true);
          }}
        >
          {scheduledTodos
            .filter((todo) => todo.isAllDayScheduled && isSameDay(new Date(todo.scheduledStartAt!), day))
            .map((todo) => (
              <CalendarBlock key={todo.id} todo={todo} now={now} selected={selectedTodoId === todo.id} onSelect={onSelectTodo} onUnschedule={onUnschedule} draggable onDragStart={dragScheduledTodo} />
            ))}
        </div>
      ))}
      {hours.map((hour) => (
        <div key={hour} className="calendar-hour-label" style={{ gridColumn: 1, gridRow: hour - DAY_START_HOUR + 3 }}>{String(hour).padStart(2, "0")}:00</div>
      ))}
      {days.map((day, dayIndex) => {
        const dayTimedTodos = scheduledTodos.filter((todo) => !todo.isAllDayScheduled && isSameDay(new Date(todo.scheduledStartAt!), day));
        const layout = getTimedLayout(dayTimedTodos);
        return (
          <div
            key={`${formatDateKey(day)}-timed`}
            className="calendar-day-column"
            style={{ gridColumn: dayIndex + 2, gridRow: `3 / span ${hours.length}` }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => scheduleDrop(event, day)}
          >
            {hours.map((hour) => (
              <div
                key={`${formatDateKey(day)}-${hour}`}
                className="calendar-hour-cell"
              />
            ))}
            {dayTimedTodos.map((todo) => {
              const bounds = getTimedBounds(todo);
              if (!bounds) return null;
              const draftEnd = resizeDraft?.todoId === todo.id ? resizeDraft.end : bounds.end;
              const startMinutes = clamp(getMinutesInDay(bounds.start), DAY_START_HOUR * 60, DAY_END_HOUR * 60);
              const endMinutes = clamp(Math.max(getMinutesInDay(draftEnd), startMinutes + MIN_TIMED_DURATION_MINUTES), DAY_START_HOUR * 60, DAY_END_HOUR * 60);
              const itemLayout = layout.get(todo.id) ?? { lane: 0, lanes: 1 };
              const width = `calc((100% - ${(itemLayout.lanes - 1) * 4}px) / ${itemLayout.lanes})`;
              const left = `calc(${itemLayout.lane} * (${width} + 4px))`;
              return (
                <CalendarBlock
                  key={todo.id}
                  todo={todo}
                  now={now}
                  selected={selectedTodoId === todo.id}
                  onSelect={onSelectTodo}
                  onUnschedule={onUnschedule}
                  draggable
                  onDragStart={dragScheduledTodo}
                  onResizeStart={startResize}
                  style={{
                    position: "absolute",
                    top: ((startMinutes - DAY_START_HOUR * 60) / 60) * HOUR_HEIGHT + 4,
                    height: Math.max(28, ((endMinutes - startMinutes) / 60) * HOUR_HEIGHT - 8),
                    left,
                    width
                  }}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function CalendarMonthCanvas({
  anchorDate,
  todos,
  now,
  selectedTodoId,
  onSelectTodo,
  onSelectDate
}: {
  anchorDate: Date;
  todos: TodoItem[];
  now: number;
  selectedTodoId: string | null;
  onSelectTodo(id: string): void;
  onSelectDate(date: Date): void;
}) {
  const { t, locale } = useI18n();
  const monthStart = startOfMonth(anchorDate);
  const days = getCalendarMonthDays(monthStart);
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(2024, 0, 1 + index);
    return day.toLocaleDateString(locale, { weekday: "short" });
  });
  return (
    <div className="calendar-month-canvas">
      {weekdayLabels.map((day) => <span key={day} className="calendar-month-weekday">{day}</span>)}
      {days.map((day) => {
        const dayTodos = todos
          .filter((todo) => isSameDay(getCalendarDisplayDate(todo), day))
          .sort(compareTodosForWork);
        return (
          <button
            key={formatDateKey(day)}
            type="button"
            className={`calendar-month-day ${day.getMonth() === monthStart.getMonth() ? "" : "muted"} ${isSameDay(day, new Date()) ? "today" : ""}`}
            onClick={() => onSelectDate(day)}
          >
            <strong>{day.getDate()}</strong>
            <div>
              {dayTodos.slice(0, 3).map((todo) => (
                <span key={todo.id} className={`${getCalendarMonthTodoClass(todo, now)} ${selectedTodoId === todo.id ? "selected" : ""}`} onClick={(event) => {
                  event.stopPropagation();
                  onSelectTodo(todo.id);
                }}>
                  {getCalendarRisk(todo, now) && <b>!</b>}
                  {todo.title}
                </span>
              ))}
              {dayTodos.length > 3 && <small>{t("+{count} 更多", { count: dayTodos.length - 3 })}</small>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

export { getTodoTargetTime };
