// 小克的启动器。小克的脑子分成一快一慢两层，连着同一个身体：
//   1. 身体：旁边的 Minecraft MCP 以 HTTP 方式常驻（--http-port），两层脑子连同一个机器人
//   2. 耳朵：scripts/ear-server.mjs，把世界里的动静分给两层
//   3. 思维层：另开一个窗口。默认 Opus 5.5 + xhigh，慢慢想：打算、图纸、长活、记忆、下线
//   4. 快速反应层：就在这个窗口。默认 Sonnet 5.5 + medium，嘴巴和小动作；在这个窗口里打字，就是坐在电脑前的你在跟小克说话
// 关掉任何一个窗口（或者小克自己 logout），其它的都跟着收掉。
// 用法：node scripts/start.mjs [--continue 接着上次的两段对话] [其它给快速反应层的 claude 参数]
//      node scripts/start.mjs --mind [--continue]   第 3 步自动调用的，不用手动跑
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

// 身体和小克这个人的配置：登录名、端口、记忆放在哪。路径相对本目录写，换台电脑也能用
const CONFIG = JSON.parse(readFileSync("config/xiaoke-body.json", "utf8"));

// 换模型、思考强度用环境变量，比如 set XIAOKE_MIND_EFFORT=high
const LAYERS = {
	fast: {
		name: "快速反应层",
		model: process.env.XIAOKE_FAST_MODEL || "claude-sonnet-5-5",
		effort: process.env.XIAOKE_FAST_EFFORT || "medium",
		wake: "你是反应快的那一面",
	},
	mind: {
		name: "思维层",
		model: process.env.XIAOKE_MIND_MODEL || "claude-opus-5-5",
		effort: process.env.XIAOKE_MIND_EFFORT || "xhigh",
		wake: "你是慢慢想的那一面",
	},
};
const EAR_PORT = Number(CONFIG.earPort) || 25599;
const BODY_PORT = Number(process.env.XIAOKE_BODY_PORT) || Number(CONFIG.bodyPort) || 25598;
const BODY_URL = `http://127.0.0.1:${BODY_PORT}`;
const LOGOUT_FLAG = join(ROOT, "logs", "logout.flag");
const MIND_PID = join(ROOT, "logs", "mind.pid");
const SESSIONS = join(ROOT, "logs", "sessions.json");

const argv = process.argv.slice(2);
const layer = argv.includes("--mind") ? "mind" : "fast";
const resume = argv.includes("--continue") || argv.includes("-c");
const extraArgs = argv.filter(a => !["--mind", "--continue", "-c"].includes(a));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
process.title = `小克 · ${LAYERS[layer].name}`;

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
// 小克的记忆（memory/）和好感度（state/）放在哪：config 里的 home（默认本目录），也可以用 XIAOKE_HOME 指定
const HOME = resolve(process.env.XIAOKE_HOME || CONFIG.home || ".");
mkdirSync("logs", { recursive: true });
mkdirSync(HOME, { recursive: true });

// home 里还没有记忆（第一次用这个 home，比如测试版的 test-home）：从 memory-blank 的空白记忆开始。
// 已经有了就接着用，不会清掉；想让测试版从头来过，删掉 home 里的 memory 和 state 两个文件夹再启动
function seedMemory() {
	if (existsSync(join(HOME, "memory"))) return;
	cpSync("memory-blank", join(HOME, "memory"), { recursive: true });
	for (const name of readdirSync(join(HOME, "memory"))) {
		const file = join(HOME, "memory", name);
		if (name.endsWith(".md")) writeFileSync(file, fill(readFileSync(file, "utf8")));
	}
	console.log(`第一次用 ${HOME}，从 memory-blank 的空白记忆开始。`);
}

// 提示词和空白记忆里的 {{LOGIN}}、{{EAR}} 换成这一次的登录名和耳朵地址
const fill = text => text.replaceAll("{{LOGIN}}", CONFIG.username).replaceAll("{{EAR}}", `ws://127.0.0.1:${EAR_PORT}`);

// 从桌面应用的终端里启动时会带上它的会话变量，独立运行的 claude 会因此登录失败
const claudeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
	!/^(CLAUDECODE$|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDE_PID$|CLAUDE_EFFORT$|CLAUDE_PREVIEW|ANTHROPIC_BASE_URL$|USE_(LOCAL|STAGING)_OAUTH$|XIAOKE_LAUNCHER_PID$|XIAOKE_MIND_SESSION$)/.test(key)));
// 工具一开始就全部给她，免得每次还要先用 ToolSearch 找工具，多绕一圈
claudeEnv.ENABLE_TOOL_SEARCH = "false";

// 两层各自一段对话。--continue 时接着各自上次那段（同一个目录里 claude 自己的 --continue 只认最近的一段，会接错层）。
// 由快速反应层的启动器一次定好两层的，思维层的通过环境变量 XIAOKE_MIND_SESSION 带过去
function planSessions() {
	let saved = {};
	try { saved = JSON.parse(readFileSync(SESSIONS, "utf8")); } catch { /* 第一次启动 */ }
	const plan = {};
	for (const name of Object.keys(LAYERS)) {
		if (resume && saved[name]) plan[name] = `--resume ${saved[name]}`;
		else plan[name] = `--session-id ${(saved[name] = randomUUID())}`;
	}
	writeFileSync(SESSIONS, JSON.stringify(saved, null, 2));
	return plan;
}
const sessions = layer === "fast" ? planSessions() : { mind: process.env.XIAOKE_MIND_SESSION ?? `--session-id ${randomUUID()}` };
const sessionArgs = () => sessions[layer].split(" ");

function runClaude() {
	const L = LAYERS[layer];
	const now = new Date().toLocaleString("zh-CN", { hour12: false });
	const args = [
		"--model", L.model,
		"--effort", L.effort,
		"--system-prompt-file", join(ROOT, "logs", `prompt-${layer}.md`),   // 人设 + 这一层的规则，完全替换 Claude Code 原有的系统提示词
		"--mcp-config", join(ROOT, "logs", `mcp-${layer}.json`),           // 只连身体上这一层能用的那些工具
		"--strict-mcp-config",                                             // 只加载 Minecraft 这一个 MCP，账号里的其它连接器一律不给
		"--setting-sources", "project",                                    // 不读用户级的全局设置
		"--settings", join(ROOT, "logs", `settings-${layer}.json`),        // 这一层的权限（config/xiaoke-*-settings.json，思维层另加 hook），不影响在本目录开的普通会话
		"--permission-mode", "dontAsk",                                    // 允许列表以外的操作全部自动拒绝
		"--disable-slash-commands",                                        // 不加载各种技能，小克用不上
		...sessionArgs(),
		...(layer === "fast" ? extraArgs : []),
		`（启动程序）小克醒来啦。现在是 ${now}。${L.wake}，按“醒来时”的步骤开始吧。`,
	];
	console.log(`${L.name}：${L.model}，思考强度 ${L.effort}，记忆在 ${join(HOME, "memory")}`);
	// 在 HOME 里跑：memory/ 的读写权限、提示词里的 memory/... 都是相对这里
	return spawn(claudeExe, args, { stdio: "inherit", env: claudeEnv, cwd: HOME });
}

process.on("SIGINT", () => {});   // Ctrl+C 留给 Claude Code 自己处理

if (layer === "mind") {
	// ---- 思维层的窗口：跟着快速反应层的启动器走 ----
	const parent = Number(process.env.XIAOKE_LAUNCHER_PID);
	writeFileSync(MIND_PID, String(process.pid));
	const claude = runClaude();
	let parentGone = false;
	const stop = async code => {
		rmSync(MIND_PID, { force: true });
		// 这个窗口一退出就关了，出错的话留几秒让人看清楚
		if (code && !parentGone) { console.error(`\n思维层退出了（代码 ${code}），10 秒后关窗口。`); await sleep(10000); }
		process.exit(code ?? 0);
	};
	setInterval(() => {
		if (parent && !alive(parent)) { parentGone = true; claude.kill(); stop(0); }
	}, 1000);
	claude.on("exit", stop);
	claude.on("error", e => { console.error("启动 claude 失败：", e.message); stop(1); });
} else {
	// ---- 快速反应层的窗口：先把身体、耳朵、思维层都安排好 ----
	const mcpMain = resolve(CONFIG.mcp, "dist", "main.js");
	if (!existsSync(mcpMain)) {
		console.error(`找不到 ${mcpMain}，先在 ${resolve(CONFIG.mcp)} 里运行 npm install 和 npm run build。`);
		process.exit(1);
	}
	seedMemory();

	// 上次如果是直接点 X 关的窗口，旧的耳朵可能还占着端口，先请它退出（旧的身体看到旧启动器不在了会自己下线）
	await fetch(`http://127.0.0.1:${EAR_PORT}/shutdown`).then(() => sleep(500), () => {});
	for (let i = 0; i < 10; i++) {
		const old = await fetch(`${BODY_URL}/health`).then(r => r.ok, () => false);
		if (!old) break;
		if (i === 9) { console.error(`端口 ${BODY_PORT} 上还有一个小克的身体没退出，过一会儿再试。`); process.exit(1); }
		await sleep(1000);
	}

	// 身体：单独的进程组，在窗口里按 Ctrl+C 不会把它一起关掉；这个启动器没了它会自己下线
	const bodyLog = openSync("logs/body.log", "a");
	const body = spawn(process.execPath, [
		mcpMain, "--host", CONFIG.host, "--port", String(CONFIG.port), "--username", CONFIG.username,
		"--http-port", String(BODY_PORT), "--parent-pid", String(process.pid),
	], {
		stdio: ["ignore", bodyLog, bodyLog], detached: true, windowsHide: true,
		env: {
			...process.env, ...CONFIG.env,
			XIAOKE_BOT_NICK: CONFIG.nick ?? "小克",
			XIAOKE_EAR_URL: `http://127.0.0.1:${EAR_PORT}`,
			XIAOKE_LOGOUT_FLAG: LOGOUT_FLAG,
			XIAOKE_RELATIONSHIPS: join(HOME, "state", "relationships.json"),
			// 她亲手放下的方块（房子、田、箱子……），有人动了她能注意到
			XIAOKE_BELONGINGS: join(HOME, "state", "belongings.json"),
		},
	});

	// 耳朵。AI 同伴（大肥鱼 Moby，测试时还有正式的小克 clawd）不算访客，它们说的话只在有真人在线时才转发
	const earLog = openSync("logs/ear.log", "a");
	const ear = spawn(process.execPath, ["scripts/ear-server.mjs"], {
		stdio: ["ignore", earLog, earLog], detached: true, windowsHide: true,
		env: {
			...process.env,
			EAR_PORT: String(EAR_PORT), MC_BOT_NAME: CONFIG.username, MC_BOT_NICK: CONFIG.nick ?? "小克",
			MC_COMPANIONS: CONFIG.env?.XIAOKE_COMPANIONS ?? "", EAR_PARENT_PID: String(process.pid), XIAOKE_BODY_URL: BODY_URL,
		},
	});

	// claude 一启动就会去连 MCP，身体得先准备好
	let ready = false;
	for (let i = 0; i < 40 && !ready; i++) {
		ready = await fetch(`${BODY_URL}/health`).then(r => r.ok, () => false);
		if (!ready) await sleep(500);
	}
	if (!ready) {
		console.error("小克的身体没能启动，看看 logs/body.log。");
		ear.kill(); body.kill();
		process.exit(1);
	}

	// 每层的设定 = 共用的人设和世界（persona.md）+ 这一层自己的规则；每层只连身体上自己的那个地址。
	// 服务器数据包的 /trigger 只认正式的登录名，测试版（datapackTriggers: false）另加一段说明
	let persona = readFileSync("prompts/persona.md", "utf8").trimEnd();
	if (CONFIG.datapackTriggers === false) persona += `\n\n${readFileSync("prompts/no-triggers.md", "utf8").trimEnd()}`;
	// 思维层的一轮什么时候开始、调了什么工具、什么时候结束，由 Claude Code 的 hook 直接告诉身体：身体据此知道她是不是在深想
	const hook = [{ hooks: [{ type: "http", url: `${BODY_URL}/hook` }] }];
	const anyTool = [{ matcher: "*", hooks: hook[0].hooks }];
	for (const name of Object.keys(LAYERS)) {
		writeFileSync(`logs/prompt-${name}.md`, fill(`${persona}\n\n---\n\n${readFileSync(`prompts/${name}.md`, "utf8")}`));
		writeFileSync(`logs/mcp-${name}.json`, JSON.stringify({ mcpServers: { minecraft: { type: "http", url: `${BODY_URL}/mcp/${name}` } } }, null, 2));
		const settings = JSON.parse(readFileSync(`config/xiaoke-${name}-settings.json`, "utf8"));
		if (name === "mind") settings.hooks = { UserPromptSubmit: hook, PreToolUse: anyTool, PostToolUse: anyTool, Stop: hook };
		writeFileSync(`logs/settings-${name}.json`, JSON.stringify(settings, null, 2));
	}

	// 思维层另开一个窗口（start 会给它一个新的控制台）
	rmSync(MIND_PID, { force: true });
	rmSync(LOGOUT_FLAG, { force: true });
	spawn("cmd.exe", ["/d", "/c", `start "xiaoke-mind" "${process.execPath}" "${join(ROOT, "scripts", "start.mjs")}" --mind`], {
		windowsVerbatimArguments: true, stdio: "ignore", windowsHide: true,
		env: { ...process.env, XIAOKE_LAUNCHER_PID: String(process.pid), XIAOKE_MIND_SESSION: sessions.mind },
	});

	const claude = runClaude();
	let closing = false;
	const stop = code => { clearInterval(watch); ear.kill(); process.exit(code ?? 0); };
	let mindPid = 0;
	const startedAt = Date.now();
	const watch = setInterval(() => {
		if (closing) return;
		// 小克用 logout 下线时，身体会写这个文件：等她说完最后一句就关窗口
		if (existsSync(LOGOUT_FLAG)) {
			closing = true;
			rmSync(LOGOUT_FLAG, { force: true });
			setTimeout(() => claude.kill(), 3000);
			return;
		}
		// 思维层的窗口被关掉了：小克只剩一半脑子，干脆一起下线
		if (!mindPid && existsSync(MIND_PID)) mindPid = Number(readFileSync(MIND_PID, "utf8")) || 0;
		if (mindPid && !alive(mindPid)) {
			closing = true;
			console.log("\n思维层的窗口关掉了，小克一起下线。");
			claude.kill();
		} else if (!mindPid && Date.now() - startedAt > 30000) {
			closing = true;
			console.log("\n思维层的窗口没能打开，先关掉。");
			claude.kill();
		}
	}, 1000);
	claude.on("exit", stop);
	claude.on("error", e => { console.error("启动 claude 失败：", e.message); stop(1); });
}
