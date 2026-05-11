import { app, BrowserWindow, globalShortcut, Menu, screen, shell, Tray, WebContents } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { processSelectedText } from "./openaiClient.js";
import { JsonStore } from "./storage.js";
import { state, collapsedPetBounds, expandedPetBounds, selectionPopoverCollapsedBounds, selectionPopoverExpandedBounds, selectionPopoverMaxExpandedBounds } from "./state.js";
import { broadcastSnapshotUpdated } from "./broadcast.js";
import { getPreloadPath, getRendererUrl, getShortcutIconPath, getTrayIcon, getWindowIcon, getWorkspaceInitialBounds, lockdownWindow, normalizeAccelerator } from "./windowUtils.js";
import { syncGlobalSelectionHook, setOpenSelectionPopoverWindow } from "./selection.js";
import { setOpenWorkspaceWindow } from "./reminder.js";
import type { AppSettings, PetWindowLayout, SelectionCapture, SelectionTextResult } from "../../shared/types.js";
import { resolveLocale, translate } from "../../shared/i18n.js";

const store = new JsonStore();
const appUserModelId = "com.local.neru";

function isTransparentPetMode(): boolean {
  return app.isPackaged || process.env.DESKTOP_PET_TRANSPARENT === "1";
}

function getPetWindowTargetBounds(expanded: boolean) {
  return expanded ? state.petWindowLayout.expanded : state.petWindowLayout.collapsed;
}

function clampWindowSize(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function sanitizePetWindowLayout(layout: PetWindowLayout): PetWindowLayout {
  const display = state.mainWindow && !state.mainWindow.isDestroyed()
    ? screen.getDisplayMatching(state.mainWindow.getBounds())
    : screen.getPrimaryDisplay();
  const { width: workWidth, height: workHeight } = display.workAreaSize;
  const maxCollapsedWidth = Math.max(collapsedPetBounds.width, Math.floor(workWidth * 0.62));
  const maxCollapsedHeight = Math.max(collapsedPetBounds.height, Math.floor(workHeight * 0.72));
  const collapsed = {
    width: clampWindowSize(layout.collapsed.width, 120, maxCollapsedWidth),
    height: clampWindowSize(layout.collapsed.height, 180, maxCollapsedHeight)
  };
  const expanded = {
    width: clampWindowSize(layout.expanded.width, Math.max(expandedPetBounds.width, collapsed.width), Math.floor(workWidth * 0.94)),
    height: clampWindowSize(layout.expanded.height, Math.max(expandedPetBounds.height, collapsed.height), Math.floor(workHeight * 0.92))
  };
  return { collapsed, expanded };
}

function applyPetWindowBounds(target: { width: number; height: number }): void {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  const bounds = state.mainWindow.getBounds();
  if (bounds.width === target.width && bounds.height === target.height) return;
  const centerX = bounds.x + bounds.width / 2;
  const bottomY = bounds.y + bounds.height;
  const workArea = screen.getDisplayMatching(bounds).workArea;
  const nextX = Math.min(
    Math.max(Math.round(centerX - target.width / 2), workArea.x),
    workArea.x + workArea.width - target.width
  );
  const nextY = Math.min(
    Math.max(Math.round(bottomY - target.height), workArea.y),
    workArea.y + workArea.height - target.height
  );
  state.mainWindow.setBounds({ x: nextX, y: nextY, width: target.width, height: target.height });
}

export function ensureWindowsNotificationShortcut(): void {
  if (process.platform !== "win32") return;
  const programsPath = join(app.getPath("appData"), "Microsoft", "Windows", "Start Menu", "Programs");
  mkdirSync(programsPath, { recursive: true });
  const shortcutPath = join(programsPath, "Neru.lnk");
  shell.writeShortcutLink(shortcutPath, "create", {
    target: process.execPath,
    args: app.isPackaged ? "" : `"${app.getAppPath()}"`,
    appUserModelId,
    description: "Neru desktop pet",
    icon: getShortcutIconPath(),
    iconIndex: 0
  });
}

export async function createWindow(): Promise<void> {
  const settings = await store.getSettings();
  const transparentMode = isTransparentPetMode();
  const initialBounds = transparentMode ? getPetWindowTargetBounds(false) : expandedPetBounds;
  state.mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: transparentMode ? 180 : 260,
    minHeight: transparentMode ? 200 : 340,
    x: 80,
    y: 80,
    show: false,
    title: "Neru",
    icon: getWindowIcon(),
    frame: !transparentMode,
    transparent: transparentMode,
    backgroundColor: transparentMode ? "#00000000" : "#eef7f2",
    resizable: !transparentMode,
    alwaysOnTop: settings.alwaysOnTop,
    skipTaskbar: transparentMode,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  state.mainWindow.setMenuBarVisibility(false);
  lockdownWindow(state.mainWindow);
  state.mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl) => {
    console.error("Renderer failed to load", { errorCode, errorDescription, validatedUrl });
  });
  state.mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error("Renderer process gone", details);
  });
  state.mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log("Renderer console", { level, message, line, sourceId });
  });
  state.mainWindow.on("close", (event) => {
    if (state.isQuitting) return;
    event.preventDefault();
    state.mainWindow?.hide();
  });
  state.mainWindow.once("ready-to-show", () => {
    if (!state.mainWindow) return;
    const readyBounds = transparentMode ? getPetWindowTargetBounds(state.petWindowExpanded) : expandedPetBounds;
    state.mainWindow.setBounds({
      x: 80,
      y: 80,
      width: readyBounds.width,
      height: readyBounds.height
    });
    state.mainWindow.show();
    state.mainWindow.focus();
    state.mainWindow.moveTop();
  });
  await state.mainWindow.loadURL(getRendererUrl());
}

export function setPetWindowExpanded(expanded: boolean): void {
  state.petWindowExpanded = expanded;
  if (!state.mainWindow || !isTransparentPetMode()) return;
  if (state.windowDragState?.window === state.mainWindow) {
    state.pendingPetExpanded = expanded;
    return;
  }
  applyPetWindowBounds(getPetWindowTargetBounds(expanded));
}

export function setPetWindowLayout(layout: PetWindowLayout): void {
  state.petWindowLayout = sanitizePetWindowLayout(layout);
  if (!state.mainWindow || !isTransparentPetMode()) return;
  if (state.windowDragState?.window === state.mainWindow) {
    state.pendingPetExpanded = state.petWindowExpanded;
    return;
  }
  applyPetWindowBounds(getPetWindowTargetBounds(state.petWindowExpanded));
}

export async function triggerQuickAiRecord(): Promise<void> {
  if (!state.mainWindow || state.mainWindow.isDestroyed()) return;
  if (!state.mainWindow.isVisible()) state.mainWindow.show();
  if (state.mainWindow.isMinimized()) state.mainWindow.restore();
  state.mainWindow.moveTop();
  state.mainWindow.focus();
  setPetWindowExpanded(true);
  state.mainWindow.webContents.send("app:quickAiRecord");
}

export async function registerQuickAiRecordShortcut(): Promise<void> {
  const settings = await store.getSettings();
  const accelerator = normalizeAccelerator(settings.quickAiRecordShortcut);
  if (state.registeredQuickAiRecordShortcut) {
    globalShortcut.unregister(state.registeredQuickAiRecordShortcut);
    state.registeredQuickAiRecordShortcut = null;
  }
  if (!accelerator) return;
  const ok = globalShortcut.register(accelerator, () => {
    void triggerQuickAiRecord();
  });
  state.registeredQuickAiRecordShortcut = ok ? accelerator : null;
  if (!ok) console.warn(`Failed to register quick AI record shortcut: ${accelerator}`);
}

export function beginWindowDrag(sender: WebContents): void {
  const targetWindow = BrowserWindow.fromWebContents(sender) ?? state.mainWindow;
  if (!targetWindow) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = targetWindow.getBounds();
  state.windowDragState = {
    window: targetWindow,
    offsetX: cursor.x - bounds.x,
    offsetY: cursor.y - bounds.y
  };
}

export function dragWindowToCursor(): void {
  if (!state.windowDragState || state.windowDragState.window.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const nextX = Math.round(cursor.x - state.windowDragState.offsetX);
  const nextY = Math.round(cursor.y - state.windowDragState.offsetY);
  const [currentX, currentY] = state.windowDragState.window.getPosition();
  if (currentX === nextX && currentY === nextY) return;
  state.windowDragState.window.setPosition(nextX, nextY, false);
}

export function endWindowDrag(): void {
  const wasDraggingMainWindow = state.windowDragState?.window === state.mainWindow;
  state.windowDragState = null;
  if (wasDraggingMainWindow && state.pendingPetExpanded !== null) {
    const expanded = state.pendingPetExpanded;
    state.pendingPetExpanded = null;
    setPetWindowExpanded(expanded);
  }
}

export async function openWorkspaceWindow(todoId?: string): Promise<void> {
  void syncGlobalSelectionHook();
  if (state.workspaceWindow && !state.workspaceWindow.isDestroyed()) {
    state.workspaceWindow.show();
    state.workspaceWindow.focus();
    if (todoId) state.workspaceWindow.webContents.send("todo:focus", todoId);
    return;
  }

  const locale = resolveLocale((await store.getSettings()).language, app.getLocale());
  const initialBounds = getWorkspaceInitialBounds();
  state.workspaceWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    minWidth: initialBounds.minWidth,
    minHeight: initialBounds.minHeight,
    show: false,
    title: translate(locale, "Neru 待办与对话"),
    icon: getWindowIcon(),
    backgroundColor: "#eef7f2",
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  state.workspaceWindow.setMenuBarVisibility(false);
  lockdownWindow(state.workspaceWindow);
  state.workspaceWindow.once("ready-to-show", () => {
    state.workspaceWindow?.show();
    state.workspaceWindow?.focus();
    if (todoId) state.workspaceWindow?.webContents.send("todo:focus", todoId);
  });
  state.workspaceWindow.on("closed", () => {
    state.workspaceWindow = null;
  });
  await state.workspaceWindow.loadURL(getRendererUrl("workspace"));
}

export async function openSelectionResultWindow(result: SelectionTextResult): Promise<void> {
  const resultWindow = new BrowserWindow({
    width: 520,
    height: 420,
    minWidth: 360,
    minHeight: 260,
    show: false,
    title: result.title,
    icon: getWindowIcon(),
    backgroundColor: "#f7fbf8",
    resizable: true,
    alwaysOnTop: false,
    skipTaskbar: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  resultWindow.setMenuBarVisibility(false);
  lockdownWindow(resultWindow);
  state.selectionResultWindows.add(resultWindow);
  resultWindow.on("closed", () => {
    state.selectionResultWindows.delete(resultWindow);
  });
  resultWindow.once("ready-to-show", () => {
    resultWindow.show();
    resultWindow.focus();
  });
  await resultWindow.loadURL(getRendererUrl("selection-result") + `&id=${encodeURIComponent(result.id)}`);
}

export async function processSelectionResultInBackground(result: SelectionTextResult, text: string, targetLanguage?: string): Promise<void> {
  try {
    const settings = await store.getSettings();
    const ai = resolveAiConfig(settings);
    const locale = resolveLocale(settings.language, app.getLocale());
    const markdown = await processSelectedText({
      ...ai,
      locale,
      action: result.action,
      text,
      targetLanguage
    });
    state.selectionResults.set(result.id, {
      ...result,
      markdown,
      status: "done",
      targetLanguage,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    state.selectionResults.set(result.id, {
      ...result,
      status: "error",
      error: error instanceof Error ? error.message : "处理失败",
      targetLanguage,
      updatedAt: new Date().toISOString()
    });
  }
}

export async function openSelectionPopoverWindow(capture: SelectionCapture, x: number, y: number): Promise<void> {
  if (state.selectionPopoverWindow && !state.selectionPopoverWindow.isDestroyed()) {
    state.selectionPopoverWindow.close();
  }
  const placement = getSelectionPopoverPlacement(x, y);
  state.selectionPopoverAnchor = { x, y, placement };
  state.selectionPopoverCaptureId = capture.id;
  const windowBounds = getSelectionPopoverBounds(x, y, true, placement);

  const locale = resolveLocale((await store.getSettings()).language, app.getLocale());
  state.selectionPopoverWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    title: translate(locale, "Neru 选中文本"),
    icon: getWindowIcon(),
    backgroundColor: "#00000000",
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  state.selectionPopoverWindow.setMenuBarVisibility(false);
  lockdownWindow(state.selectionPopoverWindow);
  state.selectionPopoverWindow.once("ready-to-show", () => {
    state.selectionPopoverWindow?.showInactive();
  });
  state.selectionPopoverWindow.on("closed", () => {
    if (state.selectionPopoverCaptureId && state.pendingSelectionCaptureIds.has(state.selectionPopoverCaptureId)) {
      state.pendingSelectionCaptureIds.delete(state.selectionPopoverCaptureId);
      state.selectionCaptures.delete(state.selectionPopoverCaptureId);
    }
    state.selectionPopoverWindow = null;
    state.selectionPopoverAnchor = null;
    state.selectionPopoverCaptureId = null;
  });
  try {
    await state.selectionPopoverWindow.loadURL(getRendererUrl("selection-popover") + `&id=${encodeURIComponent(capture.id)}&placement=${encodeURIComponent(placement)}`);
  } catch (error) {
    if (state.selectionPopoverWindow && !state.selectionPopoverWindow.isDestroyed()) state.selectionPopoverWindow.close();
    console.warn("Failed to load selection popover window", error);
  }
}

export function getSelectionPopoverPlacement(x: number, y: number): "right" | "left" {
  const display = screen.getDisplayNearestPoint({ x, y });
  const bounds = display.workArea;
  const margin = 6;
  const offset = 8;
  return x + offset + selectionPopoverMaxExpandedBounds.width <= bounds.x + bounds.width - margin ? "right" : "left";
}

export function getSelectionPopoverBounds(x: number, y: number, expanded: boolean, placement = getSelectionPopoverPlacement(x, y), requestedWidth?: number) {
  const display = screen.getDisplayNearestPoint({ x, y });
  const bounds = display.workArea;
  const margin = 6;
  const offset = 8;
  const maxExpandedWidth = Math.max(selectionPopoverCollapsedBounds.width, Math.min(selectionPopoverMaxExpandedBounds.width, bounds.width - margin * 2));
  const expandedWidth = Math.min(
    maxExpandedWidth,
    Math.max(selectionPopoverExpandedBounds.width, Math.ceil(requestedWidth ?? selectionPopoverExpandedBounds.width))
  );
  const size = expanded ? { ...selectionPopoverExpandedBounds, width: expandedWidth } : selectionPopoverCollapsedBounds;
  const preferredX = x + offset;
  const preferredY = y + offset;
  const targetX = placement === "right"
    ? preferredX
    : x + offset + selectionPopoverCollapsedBounds.width - size.width;
  const targetY = preferredY + size.height <= bounds.y + bounds.height - margin
    ? preferredY
    : y - size.height - offset;
  return {
    width: size.width,
    height: size.height,
    x: Math.round(Math.min(bounds.x + bounds.width - size.width - margin, Math.max(bounds.x + margin, targetX))),
    y: Math.round(Math.min(bounds.y + bounds.height - size.height - margin, Math.max(bounds.y + margin, targetY)))
  };
}

export function resizeSelectionPopoverWindow(expanded: boolean, requestedWidth?: number): void {
  if (!state.selectionPopoverWindow || state.selectionPopoverWindow.isDestroyed() || !state.selectionPopoverAnchor) return;
  const bounds = getSelectionPopoverBounds(state.selectionPopoverAnchor.x, state.selectionPopoverAnchor.y, expanded, state.selectionPopoverAnchor.placement, requestedWidth);
  const current = state.selectionPopoverWindow.getBounds();
  if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) {
    state.selectionPopoverWindow.setBounds(bounds, false);
  }
}

export async function createTray(): Promise<void> {
  const locale = resolveLocale((await store.getSettings()).language, app.getLocale());
  state.tray = new Tray(getTrayIcon());
  state.tray.setToolTip("Neru");
  state.tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: translate(locale, "显示 / 隐藏"), click: () => toggleWindow() },
      { type: "separator" },
      { label: translate(locale, "退出"), click: () => app.quit() }
    ])
  );
}

export async function refreshTrayMenu(): Promise<void> {
  if (!state.tray || state.tray.isDestroyed()) return;
  const locale = resolveLocale((await store.getSettings()).language, app.getLocale());
  state.tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: translate(locale, "显示 / 隐藏"), click: () => toggleWindow() },
      { type: "separator" },
      { label: translate(locale, "退出"), click: () => app.quit() }
    ])
  );
}

export function toggleWindow(): void {
  if (!state.mainWindow) return;
  if (state.mainWindow.isVisible()) state.mainWindow.hide();
  else state.mainWindow.show();
}

export function showPrimaryInstanceWindow(): void {
  const target = state.mainWindow && !state.mainWindow.isDestroyed() ? state.mainWindow : state.workspaceWindow;
  if (!target || target.isDestroyed()) return;
  if (!target.isVisible()) target.show();
  if (target.isMinimized()) target.restore();
  target.moveTop();
  target.focus();
  if (target === state.mainWindow) setPetWindowExpanded(true);
}

export function resolveAiConfig(settings: AppSettings, apiKeyOverride?: string) {
  const providerName = settings.aiProviderName || getAiProviderLabel(settings.aiProvider);
  return {
    apiKey: apiKeyOverride?.trim() || settings.aiApiKey || getAiProviderEnvKey(settings.aiProvider),
    baseURL: settings.aiBaseUrl,
    model: settings.aiModel || settings.openAiModel,
    providerName
  };
}

function getAiProviderEnvKey(provider: AppSettings["aiProvider"]): string | undefined {
  if (provider === "deepseek") return process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  return process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
}

function getAiProviderLabel(provider: AppSettings["aiProvider"]): string {
  if (provider === "openai") return "OpenAI";
  if (provider === "custom") return "自定义提供商";
  return "DeepSeek";
}

// Wire up callbacks injected into modules that cannot import window.ts directly.
setOpenSelectionPopoverWindow(openSelectionPopoverWindow);
setOpenWorkspaceWindow(openWorkspaceWindow);
