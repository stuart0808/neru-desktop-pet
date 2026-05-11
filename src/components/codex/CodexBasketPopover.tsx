import React from "react";
import { FileText, Sparkles, X } from "lucide-react";
import type { CodexApprovalPolicy, CodexDropItem, CodexSandboxPolicy } from "../../../shared/types";
import { getCodexApprovalLabel, getCodexSandboxLabel } from "../../utils/codexHelpers";
import { useI18n } from "../../i18n";

export function CodexBasketPopover({
  items,
  sandbox,
  approval,
  busy,
  error,
  onSandboxChange,
  onApprovalChange,
  onRemove,
  onClear,
  onClose,
  onStart
}: {
  items: CodexDropItem[];
  sandbox: CodexSandboxPolicy;
  approval: CodexApprovalPolicy;
  busy: boolean;
  error: string;
  onSandboxChange(value: CodexSandboxPolicy): void;
  onApprovalChange(value: CodexApprovalPolicy): void;
  onRemove(path: string): void;
  onClear(): void;
  onClose(): void;
  onStart(): void;
}) {
  const { t } = useI18n();
  return (
    <section className="codex-basket" aria-label={t("Codex 文件篮")}>
      <div className="codex-basket-header">
        <div>
          <strong>{t("Codex 文件篮")}</strong>
          <span>{items.length ? t("{count} 个项目等待处理", { count: items.length }) : t("继续拖入文件或文件夹")}</span>
        </div>
        <button type="button" onClick={onClose} aria-label={t("关闭")}>
          <X size={15} />
        </button>
      </div>
      <div className="codex-basket-list">
        {items.length === 0 ? (
          <div className="codex-empty">{t("拖入文件或文件夹后，会先加入这里。")}</div>
        ) : items.map((item) => (
          <div className="codex-basket-item" key={item.path}>
            <FileText size={14} />
            <div>
              <strong>{item.name}</strong>
              <span>{item.path}</span>
            </div>
            <button type="button" onClick={() => onRemove(item.path)} aria-label={t("移除 {name}", { name: item.name })}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="codex-policy-grid">
        <label>
          {t("权限范围")}
          <select value={sandbox} onChange={(event) => onSandboxChange(event.target.value as CodexSandboxPolicy)}>
            <option value="read-only">{t(getCodexSandboxLabel("read-only"))}</option>
            <option value="workspace-write">{t(getCodexSandboxLabel("workspace-write"))}</option>
            <option value="danger-full-access">{t(getCodexSandboxLabel("danger-full-access"))}</option>
          </select>
        </label>
        <label>
          {t("执行前确认")}
          <select value={approval} onChange={(event) => onApprovalChange(event.target.value as CodexApprovalPolicy)}>
            <option value="on-request">{t(getCodexApprovalLabel("on-request"))}</option>
            <option value="never">{t(getCodexApprovalLabel("never"))}</option>
          </select>
        </label>
      </div>
      {error && <div className="codex-error">{error}</div>}
      <div className="codex-basket-actions">
        <button type="button" onClick={onClear} disabled={!items.length || busy}>{t("清空")}</button>
        <button type="button" onClick={onStart} disabled={!items.length || busy}>
          <Sparkles size={14} /> {busy ? t("创建中...") : t("开始 Codex")}
        </button>
      </div>
    </section>
  );
}
