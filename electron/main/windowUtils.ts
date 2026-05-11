import { app, BrowserWindow, nativeImage, screen, shell } from "electron";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { workspacePreferredBounds } from "./state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getPreloadPath() {
  return join(__dirname, "../../../electron/preload.cjs");
}

export function getRendererUrl(windowMode?: "workspace" | "selection-result" | "selection-popover" | "codex") {
  const query = windowMode ? `window=${windowMode}` : "";
  return process.env.VITE_DEV_SERVER_URL
    ? `${process.env.VITE_DEV_SERVER_URL}${query ? `?${query}` : ""}`
    : (() => {
        const url = pathToFileURL(join(__dirname, "../../../dist/index.html"));
        url.search = query;
        return url.toString();
      })();
}

export function getAppIconPath() {
  return join(__dirname, "../../../src/assets/app/neru-icon.ico");
}

export function getNotificationIconPath() {
  return join(__dirname, "../../../src/assets/app/neru-icon.png");
}

export function getTrayIcon() {
  return nativeImage.createFromPath(getAppIconPath()).resize({ width: 16, height: 16 });
}

// Computed once at startup so every window shares the same allowed base.
export const appRendererBase = process.env.VITE_DEV_SERVER_URL
  ?? (pathToFileURL(join(__dirname, "../../../dist")).toString() + "/");

export function lockdownWindow(win: BrowserWindow): void {
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith(appRendererBase)) {
      event.preventDefault();
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
}

export function isAllowedExternalUrl(value: string, allowedHosts?: string[]): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (allowedHosts?.length) {
      return allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
    }
    return true;
  } catch {
    return false;
  }
}

export function getWorkspaceInitialBounds() {
  const { workAreaSize } = screen.getPrimaryDisplay();
  const minWidth = Math.min(workspacePreferredBounds.minWidth, workAreaSize.width);
  const minHeight = Math.min(workspacePreferredBounds.minHeight, workAreaSize.height);
  const width = Math.min(workspacePreferredBounds.width, Math.floor(workAreaSize.width * 0.94));
  const height = Math.min(workspacePreferredBounds.height, Math.floor(workAreaSize.height * 0.92));
  return {
    width: Math.max(minWidth, width),
    height: Math.max(minHeight, height),
    minWidth,
    minHeight
  };
}

export function normalizeAccelerator(value: string | undefined) {
  return value?.trim().replace(/\s+/g, "") || "";
}
