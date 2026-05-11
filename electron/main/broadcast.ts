import { BrowserWindow, type WebContents } from "electron";

export function broadcastSnapshotUpdated(except?: WebContents): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed() && window.webContents.id !== except?.id) {
      window.webContents.send("app:snapshotUpdated");
    }
  }
}

export function broadcastCodexEvent(sessionId: string, kind: "status" | "thread" | "item" | "delta" | "request" | "requestResolved" | "error" | "raw", payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send("codex:event", { sessionId, kind, payload });
  }
}
