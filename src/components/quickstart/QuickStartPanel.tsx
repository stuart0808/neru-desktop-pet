import React from "react";
import { BarChart3, CalendarDays, Check, Clock, FileText, ListTodo, MessageCircle, Paperclip, RotateCcw, Send, Settings } from "lucide-react";
import { useI18n } from "../../i18n";
import { workspaceThemePresets } from "../../utils/constants";

export type WorkspaceTab = "quickstart" | "workspace" | "todos" | "calendar" | "summary" | "codex" | "settings";
type QuickStartStage = "capture" | "draft" | "plan" | "review";

const quickStartExamples = [
  "明天下午 3 点提醒我交周报，并把客户反馈整理成三条要点",
  "下周一上午安排 45 分钟复盘项目进度，标记为高优先级",
  "今晚 9 点提醒我检查论文图表，把缺失数据列成待办"
];

const quickStartTours: Array<{ tab: WorkspaceTab; title: string; detail: string; action: string }> = [
  { tab: "workspace", title: "对话记录任务", detail: "直接告诉 Neru 要做什么，她会先生成待办草案，确认后才写入列表。", action: "打开对话" },
  { tab: "todos", title: "整理待办", detail: "在待办页按项目、标签、优先级筛选，并在右侧编辑截止、提醒、子任务和备注。", action: "查看待办" },
  { tab: "calendar", title: "拖入日历", detail: "把任务池里的任务安排到日/周/月视图，区分截止时间和实际计划时间。", action: "打开日历" },
  { tab: "summary", title: "复盘风险", detail: "总结页会聚合今日计划、未来重点和风险任务，适合每天收尾时检查。", action: "查看总结" },
  { tab: "codex", title: "交给 Codex", detail: "拖拽文件到桌宠或在 Codex 页选择文件夹，创建隔离副本后再开始代码任务。", action: "打开 Codex" },
  { tab: "settings", title: "调整偏好", detail: "设置模型服务、快捷键、系统通知、主题色和桌宠形象。", action: "打开设置" }
];

export function QuickStartPanel({
  onOpenTab
}: {
  onOpenTab(tab: WorkspaceTab): void;
}) {
  const { t } = useI18n();
  const [stage, setStage] = React.useState<QuickStartStage>("capture");
  const [completed, setCompleted] = React.useState<string[]>([]);
  const [selectedExample, setSelectedExample] = React.useState(quickStartExamples[0]);
  const [draftReady, setDraftReady] = React.useState(false);
  const [todoAccepted, setTodoAccepted] = React.useState(false);
  const [scheduledSlot, setScheduledSlot] = React.useState("");
  const [taskDone, setTaskDone] = React.useState(false);
  const [codexBasket, setCodexBasket] = React.useState<string[]>([]);
  const [demoNotifications, setDemoNotifications] = React.useState(true);
  const [demoTopMost, setDemoTopMost] = React.useState(true);
  const [demoAccent, setDemoAccent] = React.useState(workspaceThemePresets[0]);

  const stageIndex = ["capture", "draft", "plan", "review"].indexOf(stage);
  const progress = Math.min(100, Math.round((completed.length / 8) * 100));
  const demoTitle = selectedExample.includes("周报")
    ? t("交周报并整理客户反馈")
    : selectedExample.includes("项目")
      ? t("复盘项目进度")
      : t("检查论文图表");
  const demoDue = selectedExample.includes("周报") ? t("明天 15:00") : selectedExample.includes("项目") ? t("下周一 09:00") : t("今晚 21:00");

  function complete(id: string) {
    setCompleted((current) => current.includes(id) ? current : [...current, id]);
  }

  function moveStage(next: QuickStartStage) {
    setStage(next);
    complete(next);
  }

  function resetQuickStart() {
    setStage("capture");
    setCompleted([]);
    setSelectedExample(quickStartExamples[0]);
    setDraftReady(false);
    setTodoAccepted(false);
    setScheduledSlot("");
    setTaskDone(false);
    setCodexBasket([]);
    setDemoNotifications(true);
    setDemoTopMost(true);
    setDemoAccent(workspaceThemePresets[0]);
  }

  function createDraft() {
    setDraftReady(true);
    moveStage("draft");
    complete("workspace");
    complete("draft");
  }

  function acceptTodo() {
    if (!draftReady) return;
    setTodoAccepted(true);
    moveStage("plan");
    complete("todos");
  }

  function scheduleTodo(slot: string) {
    if (!todoAccepted) return;
    setScheduledSlot(slot);
    moveStage("plan");
    complete("calendar");
  }

  function addCodexItem(path: string) {
    setCodexBasket((current) => current.includes(path) ? current : [...current, path]);
    complete("codex");
  }

  return (
    <section className="workspace-card quickstart-card">
      <div className="section-title">
        <span>{t("快速入门")}</span>
        <button type="button" className="summary-generate-button" onClick={resetQuickStart}>
          <RotateCcw size={14} /> {t("重置")}
        </button>
      </div>
      <div className="quickstart-body">
        <section className="quickstart-hero">
          <div>
            <strong>{t("在这里体验 Neru 的完整工作流")}</strong>
            <span>{t("不用离开快速入门：生成草案、确认待办、拖入日历、复盘、试 Codex 文件篮和设置偏好。")}</span>
          </div>
          <div className="quickstart-progress" aria-label={t("入门进度 {progress}%", { progress })}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </section>

        <section className="quickstart-layout">
          <aside className="quickstart-examples">
            <strong>{t("试一个真实输入")}</strong>
            {quickStartExamples.map((example) => (
              <button
                key={example}
                type="button"
                className={selectedExample === example ? "active" : ""}
                onClick={() => {
                  setSelectedExample(example);
                  complete("example");
                }}
              >
                <MessageCircle size={14} />
                <span>{t(example)}</span>
              </button>
            ))}
            <button type="button" className="quickstart-primary" onClick={createDraft}>
              <Send size={15} /> {t("在本页生成草案")}
            </button>
          </aside>

          <section className="quickstart-flow" aria-label={t("拖动观察任务工作流")}>
            <div className="quickstart-flow-header">
              <strong>{t("拖动观察工作流")}</strong>
              <span>{t("把任务卡拖到下一步，Neru 会展示每个阶段发生了什么。")}</span>
            </div>
            <div className="quickstart-flow-grid">
              <QuickStartDropZone
                active={stage === "capture"}
                done={stageIndex > 0}
                title={t("1. 捕获")}
                detail={t("从对话、快捷键或选中文字开始记录。")}
                onDropStage={() => moveStage("capture")}
              />
              <QuickStartDropZone
                active={stage === "draft"}
                done={stageIndex > 1}
                title={t("2. 草案")}
                detail={t("AI 先拆解任务，等待你确认，不会直接写入。")}
                onDropStage={() => moveStage("draft")}
              />
              <QuickStartDropZone
                active={stage === "plan"}
                done={stageIndex > 2}
                title={t("3. 排程")}
                detail={t("确认后的任务进入待办，可拖到日历时间块。")}
                onDropStage={() => moveStage("plan")}
              />
              <QuickStartDropZone
                active={stage === "review"}
                done={stageIndex > 3}
                title={t("4. 复盘")}
                detail={t("总结页检查完成度、风险和明天重点。")}
                onDropStage={() => moveStage("review")}
              />
            </div>
            <button
              type="button"
              className="quickstart-drag-card"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData("text/plain", stage);
                event.dataTransfer.effectAllowed = "move";
              }}
            >
              <ListTodo size={15} />
              <span>{t(selectedExample)}</span>
            </button>
            <div className="quickstart-stage-note">
              {stage === "capture" && t("当前阶段：先把脑中的事项说出来，Neru 会负责整理结构。")}
              {stage === "draft" && t("当前阶段：检查 AI 草案，确认标题、时间、优先级是否正确。")}
              {stage === "plan" && t("当前阶段：在待办或日历里安排真正执行的时间。")}
              {stage === "review" && t("当前阶段：用总结页回看完成情况和风险任务。")}
            </div>
            <div className="quickstart-demo-lab">
              <article className="quickstart-demo-card">
                <div className="quickstart-demo-title">
                  <MessageCircle size={15} />
                  <strong>{t("对话与草案")}</strong>
                </div>
                <div className="quickstart-chat-sim user">{t(selectedExample)}</div>
                {draftReady ? (
                  <div className="quickstart-chat-sim assistant">
                    <strong>{demoTitle}</strong>
                    <span>{t("截止：{value}", { value: demoDue })} · {t("优先级：{value}", { value: selectedExample.includes("高优先级") ? t("P1 高") : t("P2 中") })}</span>
                    <small>{t("这是草案，确认后才会写入待办。")}</small>
                  </div>
                ) : (
                  <button type="button" onClick={createDraft}>{t("生成 AI 草案")}</button>
                )}
              </article>

              <article className="quickstart-demo-card">
                <div className="quickstart-demo-title">
                  <ListTodo size={15} />
                  <strong>{t("待办确认")}</strong>
                </div>
                <button type="button" className={`quickstart-todo-sim ${todoAccepted ? "done" : ""}`} onClick={acceptTodo} disabled={!draftReady}>
                  <span>{todoAccepted ? <Check size={13} /> : null}</span>
                  <div>
                    <strong>{demoTitle}</strong>
                    <small>{draftReady ? t("点击确认写入待办") : t("先生成草案")}</small>
                  </div>
                </button>
              </article>

              <article className="quickstart-demo-card quickstart-calendar-sim">
                <div className="quickstart-demo-title">
                  <CalendarDays size={15} />
                  <strong>{t("日历排程")}</strong>
                </div>
                <button
                  type="button"
                  className="quickstart-mini-task"
                  draggable={todoAccepted}
                  disabled={!todoAccepted}
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", "demo-task")}
                >
                  {demoTitle}
                </button>
                <div className="quickstart-slots">
                  {["上午 09:00", "下午 15:00"].map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={scheduledSlot === slot ? "active" : ""}
                      onClick={() => scheduleTodo(slot)}
                      onDragOver={(event) => {
                        if (!todoAccepted) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        scheduleTodo(slot);
                      }}
                    >
                      <Clock size={13} />
                      <span>{scheduledSlot === slot ? demoTitle : t(slot)}</span>
                    </button>
                  ))}
                </div>
              </article>

              <article className="quickstart-demo-card">
                <div className="quickstart-demo-title">
                  <BarChart3 size={15} />
                  <strong>{t("总结复盘")}</strong>
                </div>
                <div className="quickstart-kpis">
                  <span><strong>{todoAccepted ? 1 : 0}</strong> {t("已确认")}</span>
                  <span><strong>{scheduledSlot ? 1 : 0}</strong> {t("已排程")}</span>
                  <span><strong>{taskDone ? 0 : 1}</strong> {t("待关注")}</span>
                </div>
                <button type="button" onClick={() => {
                  setTaskDone(true);
                  moveStage("review");
                  complete("summary");
                }} disabled={!scheduledSlot}>
                  {t("标记完成并复盘")}
                </button>
              </article>

              <article className="quickstart-demo-card">
                <div className="quickstart-demo-title">
                  <Paperclip size={15} />
                  <strong>{t("Codex 文件篮")}</strong>
                </div>
                <div className="quickstart-file-row">
                  {["src/main.tsx", "README.md"].map((path) => (
                    <button
                      key={path}
                      type="button"
                      draggable
                      onClick={() => addCodexItem(path)}
                      onDragStart={(event) => event.dataTransfer.setData("text/plain", path)}
                    >
                      <FileText size={13} /> {path}
                    </button>
                  ))}
                </div>
                <div
                  className={`quickstart-basket ${codexBasket.length ? "filled" : ""}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    addCodexItem(event.dataTransfer.getData("text/plain"));
                  }}
                >
                  {codexBasket.length ? t("{count} 个文件已加入隔离副本", { count: codexBasket.length }) : t("拖文件到这里")}
                </div>
              </article>

              <article className="quickstart-demo-card">
                <div className="quickstart-demo-title">
                  <Settings size={15} />
                  <strong>{t("设置偏好")}</strong>
                </div>
                <div className="quickstart-setting-row">
                  <button type="button" className={demoNotifications ? "active" : ""} onClick={() => {
                    setDemoNotifications((value) => !value);
                    complete("settings");
                  }}>{t("系统通知")}</button>
                  <button type="button" className={demoTopMost ? "active" : ""} onClick={() => {
                    setDemoTopMost((value) => !value);
                    complete("settings");
                  }}>{t("始终置顶")}</button>
                </div>
                <div className="quickstart-theme-row">
                  {workspaceThemePresets.slice(0, 4).map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={demoAccent === color ? "active" : ""}
                      style={{ backgroundColor: color }}
                      onClick={() => {
                        setDemoAccent(color);
                        complete("settings");
                      }}
                      aria-label={t("体验主题色 {color}", { color })}
                    />
                  ))}
                </div>
              </article>
            </div>
          </section>

          <section className="quickstart-tour">
            <strong>{t("功能巡览")}</strong>
            {quickStartTours.map((item) => (
              <article key={item.tab} className={completed.includes(item.tab) ? "done" : ""}>
                <div>
                  <span className="quickstart-check">{completed.includes(item.tab) ? <Check size={13} /> : null}</span>
                  <div>
                    <strong>{t(item.title)}</strong>
                    <p>{t(item.detail)}</p>
                  </div>
                </div>
                <button type="button" onClick={() => {
                  complete(item.tab);
                  onOpenTab(item.tab);
                }}>
                  {t(item.action)}
                </button>
              </article>
            ))}
          </section>
        </section>
      </div>
    </section>
  );
}

function QuickStartDropZone({
  active,
  done,
  title,
  detail,
  onDropStage
}: {
  active: boolean;
  done: boolean;
  title: string;
  detail: string;
  onDropStage(): void;
}) {
  return (
    <button
      type="button"
      className={`quickstart-zone ${active ? "active" : ""} ${done ? "done" : ""}`}
      onClick={onDropStage}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDropStage();
      }}
    >
      <span>{done ? <Check size={13} /> : null}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </button>
  );
}
