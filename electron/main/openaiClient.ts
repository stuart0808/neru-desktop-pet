import OpenAI from "openai";
import type { AppLocale, ModelStructuredResult, SelectionTextAction, TodoPriority } from "../../shared/types.js";
import { translate } from "../../shared/i18n.js";

interface AiClientConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  providerName?: string;
  locale?: AppLocale;
}

const fallbackResult = (text: string, locale: AppLocale): ModelStructuredResult => ({
  replyText: translate(locale, "我先整理成任务草案，确认后再保存。当前没有配置模型服务访问密钥，所以只使用本地规则做基础抽取。"),
  mood: "thinking",
  taskIntent: "simple_todo",
  todoCandidates: localTodoExtract(text, locale)
});

export async function askPetAssistant(params: {
  apiKey?: string;
  baseURL?: string;
  model: string;
  providerName?: string;
  text: string;
  nowIso: string;
  localTimeText: string;
  timeZone: string;
  locale?: AppLocale;
}): Promise<ModelStructuredResult> {
  const locale = params.locale ?? "zh-CN";
  if (!params.apiKey) return fallbackResult(params.text, locale);

  const client = createAiClient(params);

  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      {
        role: "system",
        content: buildAssistantSystemPrompt(locale)
      },
      {
        role: "user",
        content: `用户消息发送时间（本地）：${params.localTimeText}\n用户时区：${params.timeZone}\n发送时间 UTC：${params.nowIso}\n用户消息：${params.text}`
      }
    ],
    response_format: { type: "json_object" }
  });

  const outputText = response.choices[0]?.message?.content;
  if (!outputText) throw new Error(`${params.providerName ?? "模型服务"} returned an empty response`);
  return normalizeModelResult(JSON.parse(outputText));
}

export async function summarizeRecentContext(params: {
  apiKey?: string;
  baseURL?: string;
  model: string;
  providerName?: string;
  nowIso: string;
  localTimeText: string;
  timeZone: string;
  locale?: AppLocale;
  messages: Array<{ role: string; text: string; createdAt: string }>;
  todos: Array<{ title: string; status: string; createdAt: string; dueAt?: string; remindAt?: string }>;
}): Promise<string> {
  const now = new Date(params.nowIso);
  const locale = params.locale ?? "zh-CN";
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const tomorrowStart = todayStart + 24 * 60 * 60_000;
  const openTodos = params.todos.filter((todo) => todo.status !== "done");
  const todayTodos = openTodos.filter((todo) => {
    const target = getTodoTargetTime(todo);
    const createdAt = new Date(todo.createdAt).getTime();
    return (typeof target === "number" && target < tomorrowStart) ||
      (Number.isFinite(createdAt) && createdAt >= todayStart && createdAt < tomorrowStart);
  });
  const overdueTodos = openTodos.filter((todo) => {
    const target = getTodoTargetTime(todo);
    return typeof target === "number" && target <= now.getTime();
  });
  const todayUpcomingTodos = openTodos.filter((todo) => {
    const target = getTodoTargetTime(todo);
    return typeof target === "number" && target > now.getTime() && target < tomorrowStart;
  });
  const auxiliaryTodayMessages = params.messages
    .filter((message) => {
      const createdAt = new Date(message.createdAt).getTime();
      return message.role !== "system" && Number.isFinite(createdAt) && createdAt >= todayStart && createdAt < tomorrowStart;
    })
    .slice(-12);
  if (!params.apiKey) {
    return todayTodos.length
      ? translate(locale, "当前没有配置模型服务访问密钥。根据本地数据，今天需要处理：{items}。建议先处理已过期或有明确提醒时间的事项，再整理剩余任务。", { items: todayTodos.slice(0, 6).map((todo) => todo.title).join("；") })
      : translate(locale, "当前没有配置模型服务访问密钥。根据本地数据，今天没有明确待完成事项。建议检查是否有遗漏任务，并保留一段时间处理临时事项。");
  }

  const client = createAiClient(params);

  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      {
        role: "system",
        content: buildSummarySystemPrompt(locale)
      },
      {
        role: "user",
        content: JSON.stringify({
          localTimeText: params.localTimeText,
          timeZone: params.timeZone,
          nowIso: params.nowIso,
          todayTodos,
          overdueTodos,
          todayUpcomingTodos,
          auxiliaryTodayMessages
        })
      }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || translate(locale, "暂时没有足够内容可以总结。");
}

export async function testAiConnection(params: {
  apiKey?: string;
  baseURL?: string;
  model: string;
  providerName?: string;
  locale?: AppLocale;
}): Promise<string> {
  const locale = params.locale ?? "zh-CN";
  if (!params.apiKey?.trim()) {
    throw new Error(translate(locale, "请先填写 {provider} 访问密钥，或配置对应环境变量。", { provider: params.providerName ?? translate(locale, "模型服务") }));
  }

  const client = createAiClient(params);

  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      { role: "system", content: buildConnectionTestPrompt(locale) },
      { role: "user", content: "OK" }
    ],
    max_tokens: 16,
    temperature: 0
  });

  const text = response.choices[0]?.message?.content?.trim();
  if (!Array.isArray(response.choices)) throw new Error(translate(locale, "{provider} 返回结构异常。", { provider: params.providerName ?? translate(locale, "模型服务") }));
  return text || "OK";
}

export async function processSelectedText(params: {
  apiKey?: string;
  baseURL?: string;
  model: string;
  providerName?: string;
  action: SelectionTextAction;
  text: string;
  targetLanguage?: string;
  locale?: AppLocale;
}): Promise<string> {
  const trimmed = params.text.trim();
  const locale = params.locale ?? "zh-CN";
  if (!trimmed) return "";
  if (!params.apiKey) {
    return params.action === "translate"
      ? `${translate(locale, "当前没有配置模型服务访问密钥。")}\n\n${trimmed}`
      : `${translate(locale, "当前没有配置模型服务访问密钥。")}\n\n- ${translate(locale, "已选中文字共 {count} 个字符。", { count: trimmed.length })}\n- ${translate(locale, "请配置访问密钥后使用智能总结。")}`;
  }

  const client = createAiClient(params);

  const targetLanguage = normalizeTargetLanguage(params.targetLanguage);
  const systemPrompt = params.action === "translate"
    ? buildSelectionTranslatePrompt(locale, targetLanguage)
    : buildSelectionSummaryPrompt(locale);

  const response = await client.chat.completions.create({
    model: params.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: trimmed }
    ]
  });

  return response.choices[0]?.message?.content?.trim() || translate(locale, "没有生成可展示的内容。");
}

function getOutputLanguageName(locale: AppLocale): string {
  if (locale === "en-US") return "English";
  if (locale === "ja-JP") return "Japanese";
  if (locale === "ko-KR") return "Korean";
  return "Simplified Chinese";
}

function buildAssistantSystemPrompt(locale: AppLocale): string {
  return `You are Neru, a Windows desktop pet assistant. Reply in ${getOutputLanguageName(locale)} with concise, natural, friendly but not exaggerated wording. You must also classify the user's task intent and extract todo drafts. Output JSON only, no Markdown. JSON fields must be replyText, mood, taskIntent, todoCandidates, planProposal. mood must be idle/talking/happy/thinking/reminder. taskIntent must be none/simple_todo/complex_goal. none means chat, emotion, or no clear action. simple_todo means one or more directly actionable todos such as reminders, meetings, purchases, calls, or submissions. complex_goal means a goal requiring multiple steps, such as finishing a paper, preparing an exam, creating a report, finishing a project, or organizing a portfolio. For simple_todo, todoCandidates must contain title, notes, project, tags, priority, dueAt, remindAt, subtasks, attachments, confidence; use null or empty arrays when absent. priority must be low/medium/high/urgent, use medium if unsure. tags are short strings; project is the owning project; subtasks are {title, done}; attachments are attachment names or paths. For complex_goal, leave todoCandidates empty and output planProposal with summary, sourceMessage, needsConfirmation true, and 3-6 executable steps in items using the same todo fields with reasonable time hints. Reminder phrases must create todoCandidates with title, remindAt, usually dueAt, and optional notes. Parse relative dates using the user's local send time. dueAt/remindAt must be ISO 8601 with timezone offset, for example 2026-05-04T20:00:00+08:00. Never output timezone-less times. Extracted results are drafts; never claim they have been saved.`;
}

function buildSummarySystemPrompt(locale: AppLocale): string {
  return `You are Neru's daily summary module. Write in ${getOutputLanguageName(locale)}. The summary must be based primarily on todo data: open todos for today, overdue items, and upcoming reminders today are the only primary sources. Chat history is only auxiliary context for wording and must not replace todo data or be quoted. Do not create new todos. Do not output Markdown headings. Write a concise summary and action recommendation, naturally covering today's focus, priorities, and next actions. Keep it around 120-180 Chinese characters or a similar concise length in the target language.`;
}

function buildConnectionTestPrompt(locale: AppLocale): string {
  return `You are an API connectivity test. Reply only OK. Interface language: ${getOutputLanguageName(locale)}.`;
}

function buildSelectionTranslatePrompt(locale: AppLocale, targetLanguage: string): string {
  return `You are Neru's selected-text translation module. Output Markdown body only. Do not add unrelated explanation and do not repeat the source text. Target language: ${targetLanguage}. If target language is auto, translate Chinese source mainly to English and other source languages mainly to ${getOutputLanguageName(locale)}. Preserve necessary lists, code, and terms.`;
}

function buildSelectionSummaryPrompt(locale: AppLocale): string {
  return `You are Neru's selected-text summary module. Output Markdown body only. Do not repeat the source text. Summarize key information, conclusions, and action items in ${getOutputLanguageName(locale)}. Use short lists when useful.`;
}

function createAiClient(config: AiClientConfig) {
  return new OpenAI({
    apiKey: config.apiKey,
    baseURL: normalizeBaseUrl(config.baseURL)
  });
}

function normalizeBaseUrl(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeTargetLanguage(value?: string) {
  const language = value?.trim();
  if (!language || language === "auto") return "自动";
  return language.slice(0, 40);
}

function getTodoTargetTime(todo: { dueAt?: string; remindAt?: string }) {
  const target = todo.remindAt ?? todo.dueAt;
  if (!target) return undefined;
  const time = new Date(target).getTime();
  return Number.isFinite(time) ? time : undefined;
}

function localTodoExtract(text: string, locale: AppLocale) {
  const normalized = text.trim();
  if (!/(提醒我|记一下|待办|todo|要做|需要|别忘)/i.test(normalized)) return [];
  return [
    {
      title: normalized.replace(/^(提醒我|记一下|待办[:：]?)/, "").trim() || normalized,
      notes: translate(locale, "由本地规则自动记录。配置访问密钥后会启用更准确的抽取。"),
      project: undefined,
      tags: [],
      priority: "medium" as const,
      dueAt: undefined,
      remindAt: undefined,
      subtasks: [],
      attachments: [],
      confidence: 0.55
    }
  ];
}

function normalizeModelResult(value: Partial<ModelStructuredResult>): ModelStructuredResult {
  const taskIntent = ["none", "simple_todo", "complex_goal"].includes(String(value.taskIntent))
    ? (value.taskIntent as ModelStructuredResult["taskIntent"])
    : (Array.isArray(value.todoCandidates) && value.todoCandidates.length ? "simple_todo" : "none");
  const planProposal = normalizePlanProposal(value.planProposal);
  return {
    replyText: typeof value.replyText === "string" ? value.replyText : "我在。",
    mood: ["idle", "talking", "happy", "thinking", "reminder"].includes(String(value.mood))
      ? (value.mood as ModelStructuredResult["mood"])
      : "talking",
    taskIntent,
    todoCandidates: taskIntent === "complex_goal" ? [] : normalizeTodoCandidates(value.todoCandidates),
    planProposal: taskIntent === "complex_goal" ? planProposal : null
  };
}

function normalizePlanProposal(value: ModelStructuredResult["planProposal"] | undefined) {
  if (!value || typeof value !== "object") return null;
  const items = normalizeTodoCandidates(value.items).slice(0, 6);
  if (!items.length) return null;
  return {
    summary: typeof value.summary === "string" ? value.summary : "计划建议",
    sourceMessage: typeof value.sourceMessage === "string" ? value.sourceMessage : "",
    needsConfirmation: true,
    items
  };
}

function normalizeTodoCandidates(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Record<string, unknown>;
      const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
      if (!title) return null;
      const confidence = typeof candidate.confidence === "number" ? candidate.confidence : 0.7;
      return {
        title,
        notes: typeof candidate.notes === "string" ? candidate.notes : undefined,
        project: typeof candidate.project === "string" ? candidate.project.trim() || undefined : undefined,
        tags: normalizeStringArray(candidate.tags, 8),
        priority: normalizePriority(candidate.priority),
        dueAt: typeof candidate.dueAt === "string" ? candidate.dueAt : undefined,
        remindAt: typeof candidate.remindAt === "string" ? candidate.remindAt : undefined,
        subtasks: normalizeSubtasks(candidate.subtasks),
        attachments: normalizeStringArray(candidate.attachments, 6),
        confidence
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function normalizePriority(value: unknown): TodoPriority {
  return value === "low" || value === "high" || value === "urgent" ? value : "medium";
}

function normalizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeSubtasks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { title: item.trim(), done: false };
      if (!item || typeof item !== "object") return null;
      const subtask = item as Record<string, unknown>;
      const title = typeof subtask.title === "string" ? subtask.title.trim() : "";
      if (!title) return null;
      return { title, done: subtask.done === true };
    })
    .filter((item): item is { title: string; done: boolean } => Boolean(item))
    .slice(0, 12);
}
