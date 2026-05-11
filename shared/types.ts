export type PetMood = "idle" | "talking" | "happy" | "thinking" | "reminder";

export type TodoStatus = "open" | "done" | "dismissed";
export type TodoPriority = "low" | "medium" | "high" | "urgent";

export interface TodoSubtask {
  id?: string;
  title: string;
  done?: boolean;
}

export interface TodoItem {
  id: string;
  title: string;
  notes?: string;
  project?: string;
  tags?: string[];
  priority?: TodoPriority;
  sourceMessage?: string;
  status: TodoStatus;
  createdAt: string;
  dueAt?: string;
  remindAt?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string;
  isAllDayScheduled?: boolean;
  subtasks?: TodoSubtask[];
  attachments?: string[];
  confidence?: number;
  confirmedAt?: string;
  completedAt?: string;
}

export interface ReminderItem {
  id: string;
  todoId?: string;
  title: string;
  message: string;
  remindAt: string;
  firedAt?: string;
  dismissedAt?: string;
  snoozedUntil?: string;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
  taskDraftProposal?: PlanProposal | null;
  taskDraftStatus?: "pending" | "accepted" | "dismissed";
}

export interface AppSettings {
  language: AppLanguage;
  aiProvider: "deepseek" | "openai" | "custom";
  aiProviderName?: string;
  aiBaseUrl?: string;
  aiModel: string;
  aiApiKey?: string;
  openAiApiKey?: string;
  openAiModel: string;
  alwaysOnTop: boolean;
  autoSaveTodos: boolean;
  systemNotifications: boolean;
  launchAtLogin: boolean;
  keepChatHistory: boolean;
  selectionToolsEnabled: boolean;
  quickAiRecordShortcut: string;
  workspaceThemeColor: string;
  codexExecutable: string;
  codexDefaultSandbox: CodexSandboxPolicy;
  codexDefaultApproval: CodexApprovalPolicy;
  skippedUpdateVersion?: string;
  petAppearance?: PetAppearance;
}

export type AppLocale = "zh-CN" | "en-US" | "ja-JP" | "ko-KR";
export type AppLanguage = "system" | AppLocale;

export interface PetAppearance {
  name: string;
  directory: string;
  images: Partial<Record<string, string>>;
}

export interface TodoCandidate {
  title: string;
  notes?: string;
  project?: string;
  tags?: string[];
  priority?: TodoPriority;
  dueAt?: string;
  remindAt?: string;
  subtasks?: TodoSubtask[];
  attachments?: string[];
  confidence: number;
}

export type TaskIntent = "none" | "simple_todo" | "complex_goal";

export interface PlanProposal {
  summary: string;
  sourceMessage: string;
  needsConfirmation: boolean;
  items: TodoCandidate[];
}

export interface ModelStructuredResult {
  replyText: string;
  mood: PetMood;
  taskIntent: TaskIntent;
  todoCandidates: TodoCandidate[];
  planProposal?: PlanProposal | null;
}

export interface ChatResult {
  assistantMessage: ConversationMessage;
  extractedTodos: TodoItem[];
  reminders: ReminderItem[];
  mood: PetMood;
  taskDraftProposal?: PlanProposal | null;
  planProposal?: PlanProposal | null;
}

export interface AppSnapshot {
  todos: TodoItem[];
  reminders: ReminderItem[];
  messages: ConversationMessage[];
  settings: AppSettings;
}

export type SelectionTextAction = "summarize" | "translate";

export interface SelectionTextResult {
  id: string;
  action: SelectionTextAction;
  title: string;
  markdown: string;
  status?: "pending" | "done" | "error";
  error?: string;
  targetLanguage?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface SelectionCapture {
  id: string;
  text: string;
  createdAt: string;
}

export interface SelectionReference {
  id: string;
  text: string;
  createdAt: string;
}

export interface SelectionAskDraft {
  count: number;
  text: string;
  items: SelectionReference[];
}

export type CodexSandboxPolicy = "read-only" | "workspace-write" | "danger-full-access";
export type CodexApprovalPolicy = "on-request" | "never";

export interface CodexDropItem {
  path: string;
  name: string;
  kind: "file" | "directory" | "unknown";
}

export interface CodexCopiedItem extends CodexDropItem {
  copiedName: string;
  copiedPath: string;
}

export interface CodexCreateSessionOptions {
  initialPrompt?: string;
  sandbox: CodexSandboxPolicy;
  approval: CodexApprovalPolicy;
}

export interface CodexSessionInfo {
  id: string;
  workspacePath: string;
  saved: boolean;
  savedPath?: string;
  copiedItems: CodexCopiedItem[];
  createdAt: string;
  activeThreadId?: string;
  history?: CodexSessionHistory;
  threads?: Record<string, CodexSessionHistory>;
  pendingRequests?: CodexPendingRequest[];
  resumeStatus?: CodexResumeStatus;
  selectionReferences?: SelectionReference[];
}

export interface CodexSavedSession {
  id: string;
  name: string;
  rootPath: string;
  workspacePath: string;
  createdAt: string;
  copiedItems: CodexCopiedItem[];
  activeThreadId?: string;
  history?: CodexSessionHistory;
  threads?: Record<string, CodexSessionHistory>;
  resumeStatus?: CodexResumeStatus;
}

export type CodexResumeStatus =
  | { status: "ready"; threadId?: string }
  | { status: "resumeFailed"; threadId: string; message: string }
  | { status: "localOnly"; threadId?: string; message: string };

export interface CodexPendingRequest {
  id: number | string;
  method: string;
  params: unknown;
  threadId?: string;
  createdAt: string;
}

export interface CodexUiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
}

export interface CodexUiActivity {
  id: string;
  type: string;
  title: string;
  text: string;
  status?: string;
}

export interface CodexSessionHistory {
  messages: CodexUiMessage[];
  activity: CodexUiActivity[];
  settings?: CodexThreadSettings;
}

export type CodexThreadMode = "default" | "plan";
export type CodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface CodexThreadSettings {
  model?: string;
  reasoningEffort?: CodexReasoningEffort | null;
  mode?: CodexThreadMode;
}

export interface CodexModelSummary {
  id: string;
  displayName?: string;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts?: Array<{ reasoningEffort: CodexReasoningEffort; description?: string }>;
  inputModalities?: string[];
  supportsPersonality?: boolean;
}

export interface CodexThreadSummary {
  id: string;
  preview: string;
  name?: string | null;
  path?: string | null;
  cwd: string;
  source: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodexClearCacheResult {
  deletedCount: number;
  skippedCount: number;
  freedBytes: number;
}

export interface CodexStartOptions {
  initialPrompt?: string;
  sandbox: CodexSandboxPolicy;
  approval: CodexApprovalPolicy;
}

export interface CodexOutputEvent {
  sessionId: string;
  data: string;
}

export interface CodexExitEvent {
  sessionId: string;
  exitCode: number | null;
  signal?: number;
}

export interface CodexUiEvent {
  sessionId: string;
  kind: "status" | "thread" | "item" | "delta" | "request" | "requestResolved" | "error" | "raw";
  payload: unknown;
}

export interface DesktopPetApi {
  chat: {
    sendMessage(text: string): Promise<ChatResult>;
    listMessages(): Promise<ConversationMessage[]>;
    updateTaskDraft(messageId: string, patch: Pick<ConversationMessage, "taskDraftProposal" | "taskDraftStatus">): Promise<ConversationMessage>;
    clearMessages(): Promise<void>;
    testApi(apiKey?: string): Promise<{ ok: boolean; message: string }>;
  };
  todo: {
    list(): Promise<TodoItem[]>;
    update(id: string, patch: Partial<Pick<TodoItem, "title" | "notes" | "project" | "tags" | "priority" | "status" | "dueAt" | "remindAt" | "scheduledStartAt" | "scheduledEndAt" | "isAllDayScheduled" | "subtasks" | "attachments" | "completedAt">>): Promise<TodoItem>;
    delete(id: string): Promise<TodoItem>;
    undoLastAutoSave(): Promise<TodoItem | null>;
    acceptPlanProposal(items: TodoCandidate[], sourceMessage: string, messageId?: string): Promise<{ todos: TodoItem[]; reminders: ReminderItem[] }>;
  };
  reminder: {
    list(): Promise<ReminderItem[]>;
    complete(id: string): Promise<ReminderItem>;
    dismiss(id: string): Promise<ReminderItem>;
    snooze(id: string, minutes: number): Promise<ReminderItem>;
    test(): Promise<ReminderItem>;
  };
  settings: {
    get(): Promise<AppSettings>;
    set(patch: Partial<AppSettings>): Promise<AppSettings>;
  };
  appearance: {
    selectFolder(): Promise<PetAppearance | null>;
    reset(): Promise<AppSettings>;
  };
  summary: {
    generate(): Promise<string>;
  };
  selection: {
    process(action: SelectionTextAction, text: string, targetLanguage?: string): Promise<SelectionTextResult>;
    retranslate(id: string, targetLanguage: string): Promise<SelectionTextResult>;
    getResult(id: string): Promise<SelectionTextResult | null>;
    getCapture(id: string): Promise<SelectionCapture | null>;
    resolveCapture(id: string): Promise<SelectionCapture>;
    resizePopover(expanded: boolean, width?: number): Promise<void>;
    createTodoFromCapture(id: string): Promise<void>;
    addAskCapture(id: string): Promise<SelectionAskDraft>;
    getAskDraft(): Promise<SelectionAskDraft>;
    clearAskDraft(): Promise<void>;
    submitAskDraft(): Promise<void>;
  };
  codex: {
    createSession(items: CodexDropItem[], options: CodexCreateSessionOptions): Promise<CodexSessionInfo>;
    createSessionFromFolder(options: CodexCreateSessionOptions): Promise<CodexSessionInfo | null>;
    listSavedSessions(): Promise<CodexSavedSession[]>;
    openSavedSession(savedSessionId: string, options: CodexCreateSessionOptions): Promise<CodexSessionInfo>;
    renameSavedSession(savedSessionId: string, name: string): Promise<CodexSavedSession>;
    deleteSavedSession(savedSessionId: string): Promise<void>;
    listModels(sessionId: string): Promise<CodexModelSummary[]>;
    listThreads(sessionId: string): Promise<CodexThreadSummary[]>;
    resumeThread(sessionId: string, threadId: string): Promise<CodexSessionInfo>;
    newThread(sessionId: string): Promise<CodexSessionInfo>;
    getSession(sessionId: string): Promise<CodexSessionInfo>;
    startSession(sessionId: string, options: CodexStartOptions): Promise<void>;
    sendInput(sessionId: string, text: string): Promise<void>;
    setThreadSettings(sessionId: string, settings: Partial<CodexThreadSettings>): Promise<CodexSessionInfo>;
    respondRequest(sessionId: string, requestId: number | string, response: unknown): Promise<void>;
    updateSessionHistory(sessionId: string, history: CodexSessionHistory): Promise<void>;
    write(sessionId: string, data: string): Promise<void>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    stopSession(sessionId: string): Promise<void>;
    saveSession(sessionId: string): Promise<CodexSessionInfo>;
    discardSession(sessionId: string): Promise<void>;
    clearCache(): Promise<CodexClearCacheResult>;
    openWorkspace(sessionId: string): Promise<void>;
  };
  app: {
    snapshot(): Promise<AppSnapshot>;
    setIgnoreMouseEvents(ignore: boolean): Promise<void>;
    moveWindowBy(deltaX: number, deltaY: number): Promise<void>;
    beginWindowDrag(): Promise<void>;
    dragWindowToCursor(): Promise<void>;
    endWindowDrag(): Promise<void>;
    setPetWindowExpanded(expanded: boolean): Promise<void>;
    openWorkspaceWindow(todoId?: string): Promise<void>;
    checkForUpdates(): Promise<void>;
    getPathForFile(file: File): string;
    openPath(filePath: string): Promise<{ ok: boolean; message?: string }>;
  };
  events: {
    onReminderFired(callback: (reminder: ReminderItem) => void): () => void;
    onSnapshotUpdated(callback: () => void): () => void;
    onTodoFocus(callback: (todoId: string) => void): () => void;
    onSelectedTextTodo(callback: (text: string) => void): () => void;
    onQuickAiRecord(callback: () => void): () => void;
    onCodexOutput(callback: (event: CodexOutputEvent) => void): () => void;
    onCodexExit(callback: (event: CodexExitEvent) => void): () => void;
    onCodexEvent(callback: (event: CodexUiEvent) => void): () => void;
  };
}

declare global {
  interface Window {
    desktopPet: DesktopPetApi;
  }
}
