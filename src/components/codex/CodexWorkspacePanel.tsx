import React from "react";
import { FolderOpen, RotateCcw, Trash2 } from "lucide-react";
import type { AppSettings, CodexApprovalPolicy, CodexSandboxPolicy, CodexSavedSession, CodexSessionInfo, DesktopPetApi } from "../../../shared/types";
import { CodexEmbeddedConversation } from "./CodexEmbeddedConversation";

export function CodexWorkspacePanel({ api, settings }: { api?: DesktopPetApi; settings: AppSettings | null }) {
  const [savedSessions, setSavedSessions] = React.useState<CodexSavedSession[]>([]);
  const [activeSession, setActiveSession] = React.useState<CodexSessionInfo | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [openingId, setOpeningId] = React.useState("");
  const [deletingIds, setDeletingIds] = React.useState<string[]>([]);
  const [error, setError] = React.useState("");
  const [editingId, setEditingId] = React.useState("");
  const [editingName, setEditingName] = React.useState("");
  const sandbox: CodexSandboxPolicy = settings?.codexDefaultSandbox ?? "workspace-write";
  const approval: CodexApprovalPolicy = settings?.codexDefaultApproval ?? "on-request";

  const refresh = React.useCallback(async () => {
    if (!api) return;
    setSavedSessions(await api.codex.listSavedSessions());
  }, [api]);

  React.useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : "读取 Codex 会话失败。"));
  }, [refresh]);

  async function startFromFolder() {
    if (!api || busy) return;
    setBusy(true);
    setError("");
    try {
      const session = await api.codex.createSessionFromFolder({ sandbox, approval });
      await refresh();
      if (session) setActiveSession(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "启动 Codex 失败。");
    } finally {
      setBusy(false);
    }
  }

  async function openSaved(session: CodexSavedSession) {
    if (!api || deletingIds.includes(session.id)) return;
    setOpeningId(session.id);
    setError("");
    try {
      const next = await api.codex.openSavedSession(session.id, { sandbox, approval });
      setActiveSession(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "打开保存会话失败。");
    } finally {
      setOpeningId("");
    }
  }

  async function commitRename(session: CodexSavedSession) {
    if (!api || editingId !== session.id) return;
    const nextName = editingName.trim();
    setEditingId("");
    if (!nextName || nextName === session.name) return;
    try {
      await api.codex.renameSavedSession(session.id, nextName);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "重命名失败。");
    }
  }

  async function deleteSaved(session: CodexSavedSession) {
    if (!api || deletingIds.includes(session.id)) return;
    const confirmed = window.confirm(`删除 Codex 对话"${session.name}"？对应的副本文件夹也会被删除。`);
    if (!confirmed) return;
    setError("");
    setDeletingIds((current) => [...current, session.id]);
    setSavedSessions((current) => current.filter((item) => item.id !== session.id));
    if (activeSession?.savedPath === session.rootPath || activeSession?.workspacePath === session.workspacePath) setActiveSession(null);
    try {
      await api.codex.deleteSavedSession(session.id);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "删除失败。");
      await refresh();
    } finally {
      setDeletingIds((current) => current.filter((id) => id !== session.id));
    }
  }

  return (
    <section className="workspace-card codex-workspace-card">
      <div className="section-title">
        <span>Codex</span>
        <button type="button" className="summary-generate-button" onClick={() => void refresh()} disabled={busy}>
          <RotateCcw size={14} /> 刷新
        </button>
      </div>
      <div className="codex-workspace-body">
        <aside className="codex-workspace-sidebar">
          <div className="codex-start-panel">
            <button type="button" onClick={() => void startFromFolder()} disabled={!api || busy}>
              <FolderOpen size={15} /> 选择文件夹
            </button>
            {error && <div className="codex-error">{error}</div>}
          </div>
          <div className="codex-saved-panel">
            <strong>保存的对话</strong>
            <div className="codex-saved-list">
              {savedSessions.length === 0 ? (
                <div className="summary-empty">还没有保存的 Codex 会话。</div>
              ) : savedSessions.map((session) => (
                <article key={session.id} className={`codex-saved-item ${activeSession?.savedPath === session.rootPath || activeSession?.workspacePath === session.workspacePath ? "active" : ""}`}>
                  <button type="button" className="codex-saved-main" onClick={() => void openSaved(session)} disabled={deletingIds.includes(session.id)}>
                    {editingId === session.id ? (
                      <input
                        value={editingName}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setEditingName(event.target.value)}
                        onBlur={() => void commitRename(session)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") setEditingId("");
                        }}
                      />
                    ) : (
                      <strong
                        onClick={(event) => {
                          event.stopPropagation();
                          setEditingId(session.id);
                          setEditingName(session.name);
                        }}
                      >
                        {session.name}
                      </strong>
                    )}
                    <span>{openingId === session.id ? "正在打开..." : new Date(session.createdAt).toLocaleString()}</span>
                    <small>{session.workspacePath}</small>
                  </button>
                  <button type="button" className="codex-saved-delete" onClick={() => void deleteSaved(session)} disabled={deletingIds.includes(session.id)} aria-label={`删除 ${session.name}`}>
                    <Trash2 size={13} />
                  </button>
                </article>
              ))}
            </div>
          </div>
        </aside>
        <section className="codex-workspace-conversation">
          {activeSession ? (
            <CodexEmbeddedConversation
              key={activeSession.id}
              api={api}
              sessionInfo={activeSession}
              sandbox={sandbox}
              approval={approval}
              onSessionChange={setActiveSession}
            />
          ) : (
            <div className="codex-empty codex-workspace-empty">选择一个历史对话，或先选择文件夹开始。</div>
          )}
        </section>
      </div>
    </section>
  );
}
