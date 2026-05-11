import React from "react";
import { Check, Pencil, Sparkles, Trash2, X } from "lucide-react";
import type { PlanProposal, TodoCandidate, TodoPriority } from "../../../shared/types";
import { formatPriority } from "../../utils/formatHelpers";
import { formatPlanTime, toDatetimeLocalValue, fromDatetimeLocalValue } from "../../utils/dateHelpers";
import { splitDraftList } from "../../utils/todoHelpers";
import { useI18n } from "../../i18n";

export function PlanProposalCard({
  plan,
  compact = false,
  busy,
  status = "pending",
  onAccept,
  onDismiss,
  onChangeItems
}: {
  plan: PlanProposal;
  compact?: boolean;
  busy: boolean;
  status?: "pending" | "accepted" | "dismissed";
  onAccept(): void;
  onDismiss(): void;
  onChangeItems(items: TodoCandidate[]): void;
}) {
  const { t } = useI18n();
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const visibleItems = compact ? plan.items.slice(0, 4) : plan.items;

  function updateItem(index: number, patch: Partial<TodoCandidate>) {
    onChangeItems(plan.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function discardItem(index: number) {
    const next = plan.items.filter((_, itemIndex) => itemIndex !== index);
    onChangeItems(next);
    setEditingIndex(null);
    if (!next.length) onDismiss();
  }

  return (
    <section className={`plan-card ${compact ? "compact" : ""}`}>
      <div className="plan-card-header">
        <div>
          <strong>{plan.summary || t("任务草案")}</strong>
          <span>
            {status === "accepted"
              ? t("已确认保存")
              : status === "dismissed"
                ? t("未采纳，保留为历史草案")
                : t("AI 只生成草案，确认后才会保存")}
          </span>
        </div>
        <Sparkles size={16} />
      </div>
      <div className="plan-items">
        {visibleItems.map((item, index) => (
          <div key={`${item.title}-${index}`} className="plan-item draft-item">
            <span className="plan-index">{index + 1}</span>
            <div>
              {editingIndex === index && status === "pending" ? (
                <div className="draft-edit-form">
                  <input
                    value={item.title}
                    onChange={(event) => updateItem(index, { title: event.target.value })}
                    placeholder={t("任务内容")}
                  />
                  <div className="draft-edit-grid">
                    <input
                      value={item.project ?? ""}
                      onChange={(event) => updateItem(index, { project: event.target.value || undefined })}
                      placeholder={t("项目")}
                    />
                    <select
                      value={item.priority ?? "medium"}
                      onChange={(event) => updateItem(index, { priority: event.target.value as TodoPriority })}
                    >
                      <option value="low">{t("低")}</option>
                      <option value="medium">{t("中")}</option>
                      <option value="high">{t("高")}</option>
                      <option value="urgent">{t("紧急")}</option>
                    </select>
                  </div>
                  <div className="draft-edit-grid">
                    <input
                      value={toDatetimeLocalValue(item.dueAt)}
                      onChange={(event) => updateItem(index, { dueAt: fromDatetimeLocalValue(event.target.value) })}
                      type="datetime-local"
                      title={t("截止时间")}
                    />
                  </div>
                  <input
                    value={(item.tags ?? []).join(", ")}
                    onChange={(event) => updateItem(index, { tags: splitDraftList(event.target.value) })}
                    placeholder={t("标签，用逗号分隔")}
                  />
                  <textarea
                    value={item.notes ?? ""}
                    onChange={(event) => updateItem(index, { notes: event.target.value || undefined })}
                    placeholder={t("备注")}
                    rows={2}
                  />
                  <input
                    value={(item.subtasks ?? []).map((subtask) => subtask.title).join(", ")}
                    onChange={(event) => updateItem(index, { subtasks: splitDraftList(event.target.value).map((title) => ({ title, done: false })) })}
                    placeholder={t("子任务，用逗号分隔")}
                  />
                  <input
                    value={(item.attachments ?? []).join(", ")}
                    onChange={(event) => updateItem(index, { attachments: splitDraftList(event.target.value) })}
                    placeholder={t("备注附件名称/路径，用逗号分隔")}
                  />
                  <div className="draft-actions">
                    <button type="button" onClick={() => setEditingIndex(null)} disabled={busy}>
                      <Check size={14} /> {t("完成")}
                    </button>
                    <button type="button" onClick={() => discardItem(index)} disabled={busy}>
                      <Trash2 size={14} /> {t("丢弃")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <strong>{item.title}</strong>
                  <div className="draft-meta">
                    {item.project && <small>{t("项目：{value}", { value: item.project })}</small>}
                    <small>{t("优先级：{value}", { value: t(formatPriority(item.priority)) })}</small>
                    {(item.remindAt || item.dueAt) && <small>{t("截止：{value}", { value: formatPlanTime(item.dueAt ?? item.remindAt) })}</small>}
                    {!!item.tags?.length && <small>{t("标签：{value}", { value: item.tags.join(" / ") })}</small>}
                  </div>
                  {item.notes && !compact && <p>{item.notes}</p>}
                  {!!item.subtasks?.length && !compact && <p>{t("子任务：{value}", { value: item.subtasks.map((subtask) => subtask.title).join("；") })}</p>}
                  {!!item.attachments?.length && !compact && <p>{t("附件：{value}", { value: item.attachments.join("；") })}</p>}
                  <div className="draft-actions">
                    <button type="button" onClick={() => setEditingIndex(index)} disabled={busy || status !== "pending"}>
                      <Pencil size={14} /> {t("编辑")}
                    </button>
                    <button type="button" onClick={() => discardItem(index)} disabled={busy || status !== "pending"}>
                      <Trash2 size={14} /> {t("丢弃")}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}
        {compact && plan.items.length > visibleItems.length && (
          <div className="plan-more">{t("还有 {count} 个步骤", { count: plan.items.length - visibleItems.length })}</div>
        )}
      </div>
      {status === "pending" ? (
        <div className="plan-actions">
          <button type="button" onClick={onAccept} disabled={busy || !plan.items.length}>
            <Check size={14} /> {busy ? t("写入中...") : t("确认写入")}
          </button>
          <button type="button" onClick={onDismiss} disabled={busy}>
            <X size={14} /> {t("暂不写入")}
          </button>
        </div>
      ) : (
        <div className={`draft-status ${status}`}>
          {status === "accepted" ? <Check size={14} /> : <X size={14} />}
          {status === "accepted" ? t("用户已确认保存") : t("用户未采纳")}
        </div>
      )}
    </section>
  );
}
