import { app, BrowserWindow, globalShortcut } from "electron";
import { randomUUID } from "node:crypto";
import { JsonStore } from "./storage.js";
import { state } from "./state.js";
import { registerIpc } from "./ipc.js";
import {
  ensureWindowsNotificationShortcut,
  createWindow,
  registerQuickAiRecordShortcut,
  createTray,
  showPrimaryInstanceWindow,
} from "./window.js";
import { syncGlobalSelectionHook, unregisterGlobalSelectionHook } from "./selection.js";
import { refreshReminderTimers, showReminder } from "./reminder.js";
import { checkForUpdates } from "./updates.js";

const store = new JsonStore();

app.setName("Neru");
if (process.platform === "win32") {
  app.setAppUserModelId("com.local.neru");
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.whenReady().then(async () => {
  ensureWindowsNotificationShortcut();
  await store.load();
  registerIpc();
  await createWindow();
  await syncGlobalSelectionHook();
  await registerQuickAiRecordShortcut();
  try {
    await createTray();
  } catch {
    state.tray = null;
  }
  await refreshReminderTimers();
  setTimeout(() => {
    void checkForUpdates();
  }, 3000);
  if (process.env.DESKTOP_PET_TEST_REMINDER === "1") {
    setTimeout(() => {
      void showReminder({
        id: randomUUID(),
        title: "Neru 测试提醒",
        message: "自动测试：Windows 提醒功能已触发。",
        remindAt: new Date().toISOString(),
        firedAt: new Date().toISOString()
      });
    }, 1500);
  }
});

app.on("second-instance", () => {
  showPrimaryInstanceWindow();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});

app.on("before-quit", () => {
  state.isQuitting = true;
  unregisterGlobalSelectionHook();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
