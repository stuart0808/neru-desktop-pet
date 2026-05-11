import type { AppSettings } from "../../shared/types";
import type { PetVisualState } from "./petHelpers";
import confusedImage from "../assets/pet/neru_state/_Confused_.png";
import draggingImage from "../assets/pet/neru_state/_Dragging_.png";
import happyImage from "../assets/pet/neru_state/_Happy_.png";
import idleImage from "../assets/pet/neru_state/_Idle_.png";
import reminderImage from "../assets/pet/neru_state/_Reminder_.png";
import restImage from "../assets/pet/neru_state/_Rest_.png";
import sleepyImage from "../assets/pet/neru_state/_Sleepy_.png";
import talkingImage from "../assets/pet/neru_state/_Talking_.png";
import thinkingImage from "../assets/pet/neru_state/_Thinking_.png";
import urgentImage from "../assets/pet/neru_state/_Urgent_.png";

export const petStateImages: Record<PetVisualState, string> = {
  idle: idleImage,
  talking: talkingImage,
  happy: happyImage,
  thinking: thinkingImage,
  reminder: reminderImage,
  confused: confusedImage,
  dragging: draggingImage,
  urgent: urgentImage,
  rest: restImage,
  sleepy: sleepyImage
};

export const workspaceThemePresets = ["#4d8fc8", "#5aa982", "#d59a3a", "#c56c86", "#8a75c9", "#5c8f7a"];

export const codexSlashCommands = [
  { command: "/permissions", description: "检查或调整 Codex 能做什么。" },
  { command: "/sandbox-add-read-dir", description: "把文件夹加入只读访问范围。" },
  { command: "/agent", description: "创建或管理自定义 agent。" },
  { command: "/apps", description: "连接并使用外部应用。" },
  { command: "/plugins", description: "列出或加载插件。" },
  { command: "/clear", description: "清空当前上下文。" },
  { command: "/compact", description: "压缩上下文，保留摘要继续会话。" },
  { command: "/copy", description: "复制最近一条 Codex 回复。" },
  { command: "/diff", description: "查看工作区差异。" },
  { command: "/exit", description: "退出 Codex。" },
  { command: "/experimental", description: "查看实验功能。" },
  { command: "/feedback", description: "发送反馈。" },
  { command: "/init", description: "生成或更新 AGENTS.md。" },
  { command: "/logout", description: "退出登录。" },
  { command: "/mcp", description: "查看 MCP 服务和工具。" },
  { command: "/mention", description: "打开文件选择器并引用文件。" },
  { command: "/model", description: "切换模型和推理强度。" },
  { command: "/fast", description: "切换到低推理模型。" },
  { command: "/plan", description: "进入计划模式。" },
  { command: "/personality", description: "切换回复风格。" },
  { command: "/ps", description: "查看后台 agent 任务。" },
  { command: "/stop", description: "停止当前响应。" },
  { command: "/fork", description: "从当前点 fork 会话。" },
  { command: "/side", description: "开启 side task。" },
  { command: "/resume", description: "打开会话选择器恢复会话。" },
  { command: "/new", description: "开始新会话。" },
  { command: "/quit", description: "退出 Codex。" },
  { command: "/review", description: "让 Codex 审查当前改动。" },
  { command: "/status", description: "显示当前会话和配置。" },
  { command: "/debug-config", description: "输出调试配置。" },
  { command: "/statusline", description: "管理 statusline。" },
  { command: "/title", description: "设置会话标题。" },
  { command: "/keymap", description: "打开快捷键帮助。" }
];

export const aiProviderPresets: Record<AppSettings["aiProvider"], { label: string; baseUrl: string; model: string }> = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash" },
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  custom: { label: "自定义提供商", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" }
};
