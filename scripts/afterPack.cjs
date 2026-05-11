const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const projectDir = context.projectDir || context.packager?.projectDir;
  if (!projectDir) throw new Error("Cannot resolve electron-builder project directory");

  const exePath = join(context.appOutDir, "Neru.exe");
  const iconPath = join(projectDir, "src", "assets", "app", "neru-icon.ico");
  const rceditPath = join(projectDir, "node_modules", "electron-winstaller", "vendor", "rcedit.exe");

  if (!existsSync(exePath)) throw new Error(`Cannot find packaged executable: ${exePath}`);
  if (!existsSync(iconPath)) throw new Error(`Cannot find Windows icon: ${iconPath}`);
  if (!existsSync(rceditPath)) throw new Error(`Cannot find rcedit: ${rceditPath}`);

  execFileSync(rceditPath, [
    exePath,
    "--set-icon",
    iconPath,
    "--set-version-string",
    "FileDescription",
    "Neru",
    "--set-version-string",
    "ProductName",
    "Neru"
  ], { stdio: "inherit" });
};
