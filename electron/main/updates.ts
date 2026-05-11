import { app, dialog, shell } from "electron";
import { get as httpsGet } from "node:https";
import { JsonStore } from "./storage.js";
import { state } from "./state.js";

const store = new JsonStore();
const githubRepoOwner = "stuart0808";
const githubRepoName = "neru-desktop-pet";

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  assets?: GitHubReleaseAsset[];
}

export async function checkForUpdates(manual = false): Promise<void> {
  try {
    const settings = await store.getSettings();
    const release = await fetchLatestGitHubRelease();
    const latestVersion = normalizeVersion(release.tag_name ?? release.name);
    const currentVersion = normalizeVersion(app.getVersion());
    if (!latestVersion || !currentVersion) {
      if (manual) await showUpdateInfo("无法识别版本信息", "没有从 GitHub release 中读取到可比较的版本号。");
      return;
    }
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      if (manual) await showUpdateInfo("已是最新版本", `当前版本 ${currentVersion} 已是最新版本。`);
      return;
    }
    if (!manual && settings.skippedUpdateVersion === latestVersion) return;

    const installerAsset = findWindowsInstallerAsset(release.assets);
    const downloadUrl = installerAsset?.browser_download_url ?? release.html_url;
    const releaseNotes = formatReleaseNotesForUpdateDialog(release.body);
    if (!downloadUrl) {
      if (manual) await showUpdateInfo("发现新版本", `Neru ${latestVersion} 已发布，但没有找到可用下载链接。\n\n${releaseNotes}`);
      return;
    }

    const messageOptions: Electron.MessageBoxOptions = {
      type: "info",
      title: "发现新版本",
      message: `Neru ${latestVersion} 已发布`,
      detail: `当前版本：${currentVersion}\n最新版本：${latestVersion}\n\n${releaseNotes}\n\n是否下载最新安装包？`,
      buttons: ["更新", "跳过当前版本", "稍后"],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    };
    const response = state.mainWindow
      ? await dialog.showMessageBox(state.mainWindow, messageOptions)
      : await dialog.showMessageBox(messageOptions);

    if (response.response === 0) {
      await shell.openExternal(downloadUrl);
    } else if (response.response === 1) {
      await store.updateSettings({ skippedUpdateVersion: latestVersion });
    }
  } catch (error) {
    console.error("Failed to check for updates", error);
    if (manual) {
      await showUpdateInfo("检查更新失败", error instanceof Error ? error.message : "请稍后再试。");
    }
  }
}

function formatReleaseNotesForUpdateDialog(body: string | undefined) {
  const text = body?.trim() || "暂无更新说明。";
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*/g, "")
    .trim();
  return normalized.length > 1600 ? `${normalized.slice(0, 1600).trim()}\n...` : normalized;
}

function showUpdateInfo(message: string, detail: string) {
  const messageOptions: Electron.MessageBoxOptions = {
    type: "info",
    title: "检查更新",
    message,
    detail,
    buttons: ["确定"],
    defaultId: 0,
    noLink: true
  };
  return state.mainWindow
    ? dialog.showMessageBox(state.mainWindow, messageOptions)
    : dialog.showMessageBox(messageOptions);
}

function fetchLatestGitHubRelease(): Promise<GitHubRelease> {
  const url = `https://api.github.com/repos/${githubRepoOwner}/${githubRepoName}/releases/latest`;
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": `${githubRepoName}/${app.getVersion()}`
      }
    }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        httpsGet(response.headers.location, (redirectResponse) => collectJsonResponse(redirectResponse, resolve, reject)).on("error", reject);
        return;
      }
      collectJsonResponse(response, resolve, reject);
    });
    request.setTimeout(9000, () => {
      request.destroy(new Error("检查更新超时"));
    });
    request.on("error", reject);
  });
}

function collectJsonResponse(
  response: import("node:http").IncomingMessage,
  resolve: (value: GitHubRelease) => void,
  reject: (reason?: unknown) => void
) {
  let body = "";
  response.setEncoding("utf8");
  response.on("data", (chunk) => {
    body += chunk;
  });
  response.on("end", () => {
    if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
      reject(new Error(`GitHub releases 请求失败：${response.statusCode ?? "unknown"}`));
      return;
    }
    try {
      resolve(JSON.parse(body) as GitHubRelease);
    } catch (error) {
      reject(error);
    }
  });
  response.on("error", reject);
}

function findWindowsInstallerAsset(assets: GitHubReleaseAsset[] | undefined) {
  if (!assets?.length) return undefined;
  return assets.find((asset) => asset.name?.toLowerCase().endsWith(".exe") && /setup/i.test(asset.name)) ??
    assets.find((asset) => asset.name?.toLowerCase().endsWith(".exe"));
}

function normalizeVersion(value: string | undefined) {
  const match = value?.trim().match(/^v?(\d+(?:\.\d+){0,2})/i);
  if (!match) return undefined;
  const parts = match[1].split(".").map((part) => Number.parseInt(part, 10));
  while (parts.length < 3) parts.push(0);
  return parts.slice(0, 3).join(".");
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
