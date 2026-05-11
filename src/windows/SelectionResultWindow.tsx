import React from "react";
import type { DesktopPetApi, SelectionTextResult } from "../../shared/types";
import { useI18n } from "../i18n";

const translationLanguageOptions = [
  { value: "auto", label: "自动" },
  { value: "中文", label: "中文" },
  { value: "English", label: "English" },
  { value: "日本語", label: "日本語" },
  { value: "한국어", label: "한국어" },
  { value: "Français", label: "Français" },
  { value: "Deutsch", label: "Deutsch" }
];

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      nodes.push(<strong key={`${token}-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${token}-${match.index}`}>{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownView({ markdown }: { markdown: string }) {
  const lines = markdown.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {listItems.map((item, index) => <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>)}
      </ul>
    );
    listItems = [];
  }

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const content = renderInlineMarkdown(heading[2]);
      blocks.push(level === 1
        ? <h1 key={index}>{content}</h1>
        : level === 2
          ? <h2 key={index}>{content}</h2>
          : <h3 key={index}>{content}</h3>);
      return;
    }
    const list = /^[-*]\s+(.+)$/.exec(trimmed) ?? /^\d+\.\s+(.+)$/.exec(trimmed);
    if (list) {
      listItems.push(list[1]);
      return;
    }
    flushList();
    blocks.push(<p key={index}>{renderInlineMarkdown(trimmed)}</p>);
  });
  flushList();

  return <article className="markdown-output">{blocks}</article>;
}

export function SelectionResultWindow({
  api,
  resultId,
  themeStyle
}: {
  api?: DesktopPetApi;
  resultId: string;
  themeStyle: React.CSSProperties;
}) {
  const { t, locale } = useI18n();
  const [result, setResult] = React.useState<SelectionTextResult | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!api) {
      setError(t("Neru 桌面服务暂未连接。"));
      return;
    }
    if (!resultId) {
      setError(t("结果 ID 缺失。"));
      return;
    }
    let disposed = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        const value = await api.selection.getResult(resultId);
        if (disposed) return;
        if (!value) {
          setError(t("没有找到这次处理结果。"));
          return;
        }
        setResult(value);
        if (value.status === "pending") {
          timer = window.setTimeout(load, 500);
        } else if (value.status === "error") {
          setError(value.error ?? t("处理失败。"));
        }
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : t("读取结果失败。"));
      }
    };
    void load();
    return () => {
      disposed = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [api, resultId]);

  React.useEffect(() => {
    if (!api || !resultId || result?.status !== "pending") return;
    const timer = window.setInterval(() => {
      void api.selection.getResult(resultId).then((value) => {
        if (value) {
          setResult(value);
          if (value.status === "error") setError(value.error ?? t("处理失败。"));
        }
      });
    }, 500);
    return () => window.clearInterval(timer);
  }, [api, result?.status, resultId]);

  const loadingText = result?.action === "translate" ? t("正在翻译中...") : result?.action === "summarize" ? t("正在总结中...") : t("正在加载结果...");

  async function changeTargetLanguage(targetLanguage: string) {
    if (!api || !result || result.action !== "translate" || result.status === "pending") return;
    setError("");
    const pending = await api.selection.retranslate(result.id, targetLanguage);
    setResult(pending);
  }

  return (
    <main
      className="selection-result-shell"
      style={themeStyle}
    >
      <header className="selection-result-header">
        <div className="selection-result-title">
          <strong>{result?.title ?? "Neru"}</strong>
          {result?.action === "translate" && (
            <label className="translation-target">
              <span>{t("目标语言")}</span>
              <select
                value={result.targetLanguage ?? "auto"}
                disabled={result.status === "pending"}
                onChange={(event) => void changeTargetLanguage(event.target.value)}
              >
                {translationLanguageOptions.map((option) => (
                  <option key={option.value} value={option.value}>{t(option.label)}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {result && <span>{new Date(result.createdAt).toLocaleString(locale)}</span>}
      </header>
      <section className="selection-result-body">
        {error ? (
          <div className="summary-error">{error}</div>
        ) : result && result.status !== "pending" && result.markdown ? (
          <MarkdownView markdown={result.markdown} />
        ) : (
          <div className="selection-result-loading">
            <span className="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
            {loadingText}
          </div>
        )}
      </section>
    </main>
  );
}
