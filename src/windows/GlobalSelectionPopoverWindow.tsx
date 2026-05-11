import React from "react";
import { FileText, Languages, ListTodo, MessageCircle, Sparkles } from "lucide-react";
import type { DesktopPetApi, SelectionAskDraft, SelectionCapture } from "../../shared/types";
import { useI18n } from "../i18n";

type SelectionAction = "summarize" | "translate" | "todo" | "ask" | "ask-submit";

export function GlobalSelectionPopoverWindow({
  api,
  captureId,
  placement,
  themeStyle
}: {
  api?: DesktopPetApi;
  captureId: string;
  placement: "right" | "left";
  themeStyle: React.CSSProperties;
}) {
  const { t } = useI18n();
  const shellRef = React.useRef<HTMLElement | null>(null);
  const toolbarRef = React.useRef<HTMLDivElement | null>(null);
  const [capture, setCapture] = React.useState<SelectionCapture | null>(null);
  const [busyAction, setBusyAction] = React.useState<SelectionAction | null>(null);
  const [askDraft, setAskDraft] = React.useState<SelectionAskDraft>({ count: 0, text: "", items: [] });
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!api) {
      setError(t("Neru 桌面服务暂未连接"));
      return;
    }
    if (!captureId) {
      setError(t("选区丢失"));
      return;
    }
    void api.selection.getCapture(captureId)
      .then((value) => {
        if (value) setCapture(value);
        else setError(t("选区已失效"));
      })
      .catch(() => setError(t("读取选区失败")));
    void api.selection.getAskDraft().then(setAskDraft).catch(() => undefined);
  }, [api, captureId]);

  React.useEffect(() => {
    if (busyAction) return;
    const timer = window.setTimeout(() => window.close(), 4500);
    return () => window.clearTimeout(timer);
  }, [busyAction]);

  React.useEffect(() => {
    return () => {
      void api?.selection.resizePopover(false);
    };
  }, [api]);

  function getExpandedWidth() {
    const toolbarWidth = toolbarRef.current?.scrollWidth ?? 0;
    const dotWidth = 28;
    const paddingAndBorder = 14;
    const gap = 6;
    return Math.ceil(dotWidth + toolbarWidth + paddingAndBorder + gap);
  }

  function resizePopover(expanded: boolean) {
    if (!api) return;
    const width = expanded ? getExpandedWidth() : undefined;
    void api.selection.resizePopover(expanded, width);
  }

  async function runAction(action: SelectionAction) {
    if (!api || !capture || busyAction) return;
    setBusyAction(action);
    setError("");
    try {
      const resolvedCapture = await api.selection.resolveCapture(capture.id);
      setCapture(resolvedCapture);
      if (action === "todo") {
        await api.selection.createTodoFromCapture(resolvedCapture.id);
      } else if (action === "ask") {
        setAskDraft(await api.selection.addAskCapture(resolvedCapture.id));
        setBusyAction(null);
        return;
      } else if (action === "ask-submit") {
        if (askDraft.count === 0) await api.selection.addAskCapture(resolvedCapture.id);
        await api.selection.submitAskDraft();
      } else {
        await api.selection.process(action, resolvedCapture.text);
      }
      window.close();
    } catch (reason) {
      if (reason instanceof Error && /没有读取到选中文字|Selected text is empty/i.test(reason.message)) {
        window.close();
        return;
      }
      setError(reason instanceof Error ? reason.message : t("处理失败"));
      setBusyAction(null);
    }
  }

  return (
    <main
      className={`global-selection-popover-shell ${placement === "left" ? "expand-left" : "expand-right"}`}
      ref={shellRef}
      style={themeStyle}
      onMouseEnter={() => resizePopover(true)}
      onMouseLeave={() => resizePopover(false)}
      onFocus={() => resizePopover(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          resizePopover(false);
        }
      }}
    >
      {error ? (
        <div className="global-selection-error">{error}</div>
      ) : (
        <>
          <span className="selection-popover-dot" aria-hidden="true">
            <Sparkles size={16} />
          </span>
          <div className="selection-toolbar" ref={toolbarRef} aria-label={t("选中文字操作")}>
            <button type="button" title={t("总结")} disabled={!capture || Boolean(busyAction)} onClick={() => void runAction("summarize")}>
              <FileText size={14} /> {busyAction === "summarize" ? t("总结中...") : t("总结")}
            </button>
            <button type="button" title={t("翻译")} disabled={!capture || Boolean(busyAction)} onClick={() => void runAction("translate")}>
              <Languages size={14} /> {busyAction === "translate" ? t("翻译中...") : t("翻译")}
            </button>
            <button type="button" title={t("生成待办")} disabled={!capture || Boolean(busyAction)} onClick={() => void runAction("todo")}>
              <ListTodo size={14} /> {busyAction === "todo" ? t("整理中...") : t("待办")}
            </button>
            <button type="button" title={t("加入提问")} disabled={!capture || Boolean(busyAction)} onClick={() => void runAction("ask")}>
              <MessageCircle size={14} /> {busyAction === "ask" ? t("加入中...") : t("加入{count}", { count: askDraft.count ? ` ${askDraft.count}` : "" })}
            </button>
            <button type="button" title={t("提交提问")} disabled={!capture || Boolean(busyAction)} onClick={() => void runAction("ask-submit")}>
              <Sparkles size={14} /> {busyAction === "ask-submit" ? t("打开中...") : t("提问")}
            </button>
          </div>
        </>
      )}
    </main>
  );
}
