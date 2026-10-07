// 小克的启动器：找到 claude、在后台开耳朵、用小克的设定启动 Claude Code，退出时把耳朵关掉
// 用法：node scripts/start.mjs [额外的 claude 参数，比如 --continue 接着上次的对话]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// 想换模型就设环境变量 XIAOKE_MODEL：默认 Opus 5.5，更聪明；sonnet 回话更快、用量大约省一半
const MODEL = process.env.XIAOKE_MODEL || "claude-opus-5-5";
// 思考强度：low / medium / high。high 想得更周到，但每次回话要多等一会儿
const EFFORT = process.env.XIAOKE_EFFORT || "medium";

process.chdir(join(dirname(fileURLToPath(import.meta.url)), ".."));

function findClaude() {
	for (const dir of (process.env.PATH ?? "").split(";")) {
		const exe = join(dir, "claude.exe");
		if (dir && existsSync(exe)) return exe;
	}
	// 桌面应用自带的版本，取最新的
	const base = join(process.env.APPDATA ?? "", "Claude", "claude-code");
	if (!existsSync(base)) return null;
	const versions = readdirSync(base)
		.filter(v => existsSync(join(base, v, "claude.exe")))
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
	return versions.length ? join(base, versions.at(-1), "claude.exe") : null;
}

const claudeExe = findClaude();
if (!claudeExe) {
	console.error("找不到 claude 程序，请先安装 Claude Code 或 Claude 桌面应用。");
	process.exit(1);
}

// 上次如果是直接点 X 关的窗口，启动器来不及收尾，旧的耳朵（可能还是旧代码）会一直占着端口，先请它退出
mkdirSync("logs", { recursive: true });
await fetch("http://127.0.0.1:25599/shutdown").then(() => new Promise(r => setTimeout(r, 500)), () => {});

// 小克的耳朵：单独的进程组，这样在小克窗口里按 Ctrl+C 不会把它一起关掉
const earLog = openSync("logs/ear.log", "a");
// 大肥鱼（Moby，../mc-bot-deepseek）是同一个服务器上的 AI 同伴：不算访客，它说的话只在有真人在线时才转发
const ear = spawn(process.execPath, ["scripts/ear-server.mjs"], {
	stdio: ["ignore", earLog, earLog], detached: true, windowsHide: true,
	env: { ...process.env, MC_COMPANIONS: "Moby" },
});

// 从桌面应用的终端里启动时会带上它的会话变量，独立运行的 claude 会因此登录失败
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
	!/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW|ANTHROPIC_BASE_URL$|USE_(LOCAL|STAGING)_OAUTH$)/.test(key)));

const now = new Date().toLocaleString("zh-CN", { hour12: false });
const args = [
	"--model", MODEL,
	"--effort", EFFORT,
	"--system-prompt-file", "prompts/system.md",   // 用小克的设定完全替换 Claude Code 原有的系统提示词
	"--mcp-config", "config/xiaoke-mcp.json",       // 不叫 .mcp.json，免得在本目录开的普通会话也用 clawd 登录把小克挤下线
	"--strict-mcp-config",                          // 只加载 Minecraft 这一个 MCP，账号里的其它连接器一律不给
	"--setting-sources", "project",                 // 不读用户级的全局设置
	"--settings", "config/xiaoke-settings.json",    // 小克的权限只在这里给，不影响在本目录开的普通会话
	"--permission-mode", "dontAsk",                 // 允许列表以外的操作全部自动拒绝
	"--disable-slash-commands",                     // 不加载各种技能，小克用不上
	...process.argv.slice(2),
	`（启动程序）小克醒来啦。现在是 ${now}，按“醒来时”的步骤开始吧。`,
];

process.on("SIGINT", () => {});   // Ctrl+C 留给 Claude Code 自己处理
// 小克用 logout 工具下线时，MCP 会写这个文件（路径配在 config/xiaoke-mcp.json 的 env 里），看到就把窗口关掉
const LOGOUT_FLAG = "logs/logout.flag";
rmSync(LOGOUT_FLAG, { force: true });
const claude = spawn(claudeExe, args, { stdio: "inherit", env });
const stop = code => { clearInterval(logoutWatch); ear.kill(); process.exit(code ?? 0); };
const logoutWatch = setInterval(() => {
	if (!existsSync(LOGOUT_FLAG)) return;
	clearInterval(logoutWatch);
	rmSync(LOGOUT_FLAG, { force: true });
	setTimeout(() => claude.kill(), 3000);
}, 1000);
claude.on("exit", stop);
claude.on("error", e => { console.error("启动 claude 失败：", e.message); stop(1); });
