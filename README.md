# Neru Desktop Pet

Neru 是一个 Windows 桌面宠物应用。它把透明桌宠、AI 对话、待办草案确认、日历排程、每日总结、Codex 工作流和系统提醒整合在一个轻量桌面助手里，适合用来陪伴式整理当天任务。

## 功能概览

- 透明桌宠窗口：支持拖动定位、单击气泡对话、打开 Neru 主窗口。
- 快速入门：在 Neru 主窗口内用交互式流程体验对话草案、待办确认、日历排程、总结复盘、Codex 文件篮和设置偏好。
- AI 任务记录：用户先用自然语言描述任务，AI 生成待办草案，确认后才写入本地数据。
- 待办管理：支持范围过滤、项目、标签、优先级、截止时间、提醒、计划时间、子任务、备注和附件。
- 日历排程：支持日/周/月视图，可把任务池里的任务安排到时间块，并区分截止时间和计划执行时间。
- 总结视图：支持今天/本周/本月视图，展示计划、复盘指标、风险任务和 AI 总结。
- Codex 工作流：支持拖拽文件/文件夹创建隔离副本、保存会话、恢复线程、新建线程、模型切换和指令补全。
- 全局选区工具：可对选中文字做总结、翻译或转成待办。
- Windows 提醒：支持桌宠提醒气泡和系统通知。
- 可配置外观：支持主题色和自定义桌宠状态图片文件夹。
- 可配置模型服务：支持 DeepSeek、OpenAI 或兼容 OpenAI 接口的自定义提供商。

## Release

最新版本：`v0.1.0`

Windows 安装包由 `electron-builder` 生成，文件名为：

```text
Neru Setup 0.1.0.exe
```


## 使用方式

启动后，桌面上会出现 Neru 桌宠：

- 单击桌宠：打开快速对话气泡。
- 打开 Neru 主窗口：进入完整工作台。
- 使用快捷键：默认 `CommandOrControl+Shift+Space`，快速唤出 AI 记录气泡。
- 拖拽文件到桌宠：加入 Codex 文件篮，确认后创建隔离副本。

Neru 主窗口包含：

- 快速入门：新用户交互式体验完整流程。
- 对话：和 Neru 对话，生成待办草案。
- 待办：集中整理任务属性。
- 日历：安排执行时间。
- 总结：复盘计划和风险。
- Codex：面向代码任务的隔离工作流。
- 设置：配置 AI、Codex、快捷键、通知、主题和形象。

## Development

安装依赖：

```powershell
npm install
```

开发运行：

```powershell
npm run dev
```

不透明窗口开发模式：

```powershell
npm run dev:solid
```

类型检查：

```powershell
npm run typecheck
```

生产构建：

```powershell
npm run build
npx electron .
```

Windows 安装包：

```powershell
npm run dist:win
```

## 模型服务

默认提供商为 DeepSeek。优先读取系统环境变量：

```powershell
$env:DEEPSEEK_API_KEY="sk-..."
```

也可以在应用设置面板里填写访问密钥、服务地址和模型名称。自定义提供商需要兼容 OpenAI Chat Completions API。

默认模型为：

```text
deepseek-v4-flash
```

## Codex

Codex 功能面向代码任务：

- 可从 Neru 主窗口选择文件夹开始。
- 可把文件或文件夹拖到桌宠文件篮。
- 每次会话会先复制到隔离工作目录，避免直接修改原文件。
- 支持保存会话、恢复历史线程、新建线程、停止会话。
- 支持 `/model`、`/review`、`/compact`、`@文件名` 等输入补全。

Codex 启动命令可在设置中配置。默认值为：

```text
codex
```

可填写 `codex`、完整 `codex.cmd` 路径，或带参数的命令。

## Icons

应用图标资源位于：

```text
src/assets/app/neru-icon.png
src/assets/app/neru-icon.ico
```

Windows 打包时会使用 `scripts/afterPack.cjs` 通过本地 `rcedit.exe` 把图标写入 `Neru.exe`，避免安装后桌面快捷方式和任务栏显示 Electron 默认图标。

## Character Assets

当前版本内置 PNG 状态素材，默认位置：

```text
src/assets/pet/neru_state
```

也可以在设置中选择自定义桌宠形象文件夹。文件夹名建议为：

```text
{角色名}_state
```

图片文件名示例：

```text
_Idle_.png
_Talking_.png
_Happy_.png
_Thinking_.png
_Reminder_.png
```

建议 AI 资产提示词：

```text
Q版 Neru 原创桌面宠物，使用原创服装、原创发饰、原创配色和原创角色标识，可爱二头身比例，正面站姿，透明背景，适合 Windows 桌面宠物，清晰边缘，状态表情明确，无文字，无水印，不复刻或模仿任何既有角色。
```

如果用于公开发布，请确认素材授权；当前项目默认按个人本地使用处理。
