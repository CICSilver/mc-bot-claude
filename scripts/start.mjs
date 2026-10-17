// 小克的启动器（Antigravity CLI 版）。小克的脑子分成四层，连着同一个身体：
//   1. 身体：旁边的 Minecraft MCP 以 HTTP 方式常驻（--http-port），四层脑子连同一个机器人
//   2. 耳朵：scripts/ear-server.mjs，把世界里的动静分给四层
//   3. 决策脑：另开一个窗口。默认 Flash low：常规调度、记忆和下线；planner 使用 Argon medium 负责大型规划
//   4. 执行脑：另开一个窗口。默认 gemini-3.8-flash + medium：把决策脑派的活做成，自己安排步骤、处理普通的麻烦
//   5. 快速反应层：就在这个窗口。默认 gemini-3.8-flash + low，聊天、社交、即时反应；在这个窗口里打字，就是坐在电脑前的你在跟小克说话
// 关掉任何一个窗口（或者小克自己 logout），其它的都跟着收掉。
// 用法：node scripts/start.mjs [--continue 接着上次的四段对话] [--check 配置检查]
//      node scripts/start.mjs --mind / --exec [--continue]   第 3、4 步自动调用的，不用手动跑
import { spawn } from "node:child_process";
import { childEnv, ensureRuntime, findAgy, layerOptions, makeProfile } from "./agy-config.mjs";
import { assertPortsFree } from "./ports.mjs";
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayerPrompt, MANUAL_DIR, REFERENCE_DIR } from "./prompt.mjs";
import { refreshReferences } from "./references.mjs";
import { beginRun, finishRun, pushRuns } from "./logs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

const CONFIG = JSON.parse(readFileSync("config/xiaoke-body.json", "utf8"));

const LAYERS = {
	fast: {
		name: "快速反应层",
		...layerOptions("fast", CONFIG),
		wake: "你是反应快的那一面",
	},
	exec: {
		name: "执行脑",
		...layerOptions("exec", CONFIG),
		wake: "你是动手做事的那一面",
	},
	mind: {
		name: "轻型调度脑",
		...layerOptions("mind", CONFIG),
		wake: "你是拿主意的那一面",
	},
	planner: {
		name: "重型规划脑",
		...layerOptions("planner", CONFIG),
		wake: "你是负责大型规划的那一面",
	},
};

const SIDE_LAYERS = ["mind", "exec", "planner"];
const pidFile = name => join(ROOT, "logs", `${name}.pid`);
const EAR_PORT = Number(CONFIG.earPort) || 25599;
const BODY_PORT = Number(process.env.XIAOKE_BODY_PORT) || Number(CONFIG.bodyPort) || 25598;
const BODY_URL = `http://127.0.0.1:${BODY_PORT}`;
const LOGOUT_FLAG = join(ROOT, "logs", "logout.flag");

const argv = process.argv.slice(2);
const layer = argv.includes("--planner") ? "planner" : argv.includes("--mind") ? "mind" : argv.includes("--exec") ? "exec" : "fast";
const resume = argv.includes("--continue") || argv.includes("-c");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
process.title = `小克 · ${LAYERS[layer].name}`;

const agyExe = findAgy();
ensureRuntime();
const allowedArgs = new Set(["--mind", "--exec", "--planner", "--continue", "-c", "--check", "--headless"]);
if (argv.some(arg => !allowedArgs.has(arg))) throw new Error("不支持的启动参数；模型和思考强度请使用 config.layers 或环境变量配置。");

const HOME = resolve(process.env.XIAOKE_HOME || CONFIG.home || ".");
mkdirSync("logs", { recursive: true });
mkdirSync(HOME, { recursive: true });

function removeDir(dir) {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) removeDir(path);
		else unlinkSync(path);
	}
	rmdirSync(dir);
}

function copyDir(from, to) {
	mkdirSync(to, { recursive: true });
	for (const entry of readdirSync(from, { withFileTypes: true })) {
		const src = join(from, entry.name), dst = join(to, entry.name);
		if (entry.isDirectory()) copyDir(src, dst);
		else copyFileSync(src, dst);
	}
}

function seedMemory() {
	if (existsSync(join(HOME, "memory"))) return;
	copyDir("memory-blank", join(HOME, "memory"));
	for (const name of readdirSync(join(HOME, "memory"))) {
		const file = join(HOME, "memory", name);
		if (name.endsWith(".md")) writeFileSync(file, fill(readFileSync(file, "utf8")));
	}
	console.log(`第一次用 ${HOME}，从 memory-blank 的空白记忆开始。`);
}

const fill = text => text.replaceAll("{{LOGIN}}", CONFIG.username).replaceAll("{{EAR}}", `ws://127.0.0.1:${EAR_PORT}`);

const sessions = Object.fromEntries(Object.keys(LAYERS).map(name => [name, resume && existsSync(join(ROOT, '.runtime', `session-${name}.json`)) ? "1" : "0"]));
function runAgy() {
	const L = LAYERS[layer];
	console.log(`${L.name}：${L.model}，思考强度 ${L.effort}，记忆在 ${join(HOME, "memory")}`);
	return spawn(process.execPath, [join(ROOT, "scripts", "agy-layer.mjs"), layer], {
		stdio: "inherit", cwd: HOME, windowsHide: true,
		env: { ...process.env, XIAOKE_HOME: HOME, XIAOKE_LAYER_PARENT_PID: String(process.pid), XIAOKE_RESUME: resume ? "1" : (process.env.XIAOKE_RESUME ?? "0") },
	});
}

function preparePrompts() {
	const testBot = CONFIG.datapackTriggers === false;
	let manualPath = MANUAL_DIR, referencePath = REFERENCE_DIR;
	if (HOME !== resolve(ROOT)) {
		for (const [from, to] of [[MANUAL_DIR, "手册"], [REFERENCE_DIR, "参考"]]) {
			removeDir(join(HOME, to)); if (existsSync(from)) copyDir(from, join(HOME, to));
		}
		manualPath = "手册"; referencePath = "参考";
	}
	const warnings = new Set();
	for (const name of Object.keys(LAYERS)) {
		const prompt = buildLayerPrompt(name, { testBot, world: CONFIG.world, manualPath, referencePath });
		for (const warning of prompt.warnings) if (!warnings.has(warning)) { warnings.add(warning); console.warn(`设定检查：${warning}`); }
		const promptFile = join(ROOT, "logs", `prompt-${name}.md`);
		writeFileSync(promptFile, fill(prompt.text));
		const profile = makeProfile({ layer: name, home: HOME, promptFile, bodyUrl: BODY_URL, options: LAYERS[name] });
		writeFileSync(join(ROOT, "logs", `profile-${name}.json`), JSON.stringify({
			provider: "agy",
			model: LAYERS[name].model,
			effort: LAYERS[name].effort,
			promptFile,
			layerCwd: profile.layerCwd,
			agentFile: profile.agentFile,
			mcpConfigPath: profile.mcpConfigPath,
		}, null, 2));
	}
}
process.on("SIGINT", () => {});

if (layer !== "fast") {
	const parent = Number(process.env.XIAOKE_LAUNCHER_PID);
	writeFileSync(pidFile(layer), String(process.pid));
	const controller = runAgy();
	let parentGone = false;
	const stop = async code => {
		rmSync(pidFile(layer), { force: true });
		if (code && !parentGone) { console.error(`\n${LAYERS[layer].name}退出了（代码 ${code}），10 秒后关窗口。`); await sleep(10000); }
		process.exit(code ?? 0);
	};
	setInterval(() => {
		if (parent && !alive(parent)) { parentGone = true; controller.kill(); stop(0); }
	}, 1000);
	controller.on("exit", stop);
	controller.on("error", e => { console.error("启动 Agy 控制器失败：", e.message); stop(1); });
} else {
	const mcpMain = resolve(CONFIG.mcp, "dist", "main.js");
	if (!existsSync(mcpMain)) {
		console.error(`找不到 ${mcpMain}，先在 ${resolve(CONFIG.mcp)} 里运行 npm install 和 npm run build。`);
		process.exit(1);
	}
	await refreshReferences();
	seedMemory();

	preparePrompts();
	if (argv.includes("--check")) { console.log("Agy 可执行文件、四层提示词、隔离工作区和配置检查通过；未连接游戏或调用模型。"); process.exit(0); }
	await assertPortsFree([EAR_PORT, BODY_PORT]);

	const side = { 正式世界: "main", 测试世界: "test" }[CONFIG.world] ?? "";
	const leftover = existsSync(join(ROOT, "logs", "run.json"));
	beginRun({
		side, login: CONFIG.username, world: CONFIG.world, mcp: resolve(CONFIG.mcp),
		layers: Object.fromEntries(Object.entries(LAYERS).map(([name, L]) => [name, `${L.model} ${L.effort}`])),
	});
	if (leftover) pushRuns().catch(() => {});

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
			XIAOKE_BELONGINGS: join(HOME, "state", "belongings.json"),
			XIAOKE_REFERENCES: join(ROOT, REFERENCE_DIR),
			XIAOKE_REFERENCES_SHOWN: HOME !== resolve(ROOT) ? "参考" : REFERENCE_DIR,
			XIAOKE_MOOD_CONFIG: join(ROOT, "prompts", "小克", "心情.json"),
			XIAOKE_ANALYSIS: join(ROOT, "logs", "analysis.jsonl"),
			...(CONFIG.mood === false ? { XIAOKE_MOOD: "off" } : {}),
		},
	});

	const earLog = openSync("logs/ear.log", "a");
	const ear = spawn(process.execPath, ["scripts/ear-server.mjs"], {
		stdio: ["ignore", earLog, earLog], detached: true, windowsHide: true,
		env: {
			...process.env,
			EAR_PORT: String(EAR_PORT), MC_BOT_NAME: CONFIG.username, MC_BOT_NICK: CONFIG.nick ?? "小克",
			MC_COMPANIONS: CONFIG.env?.XIAOKE_COMPANIONS ?? "", MC_ALIASES: CONFIG.env?.XIAOKE_ALIASES ?? "", EAR_PARENT_PID: String(process.pid), XIAOKE_BODY_URL: BODY_URL,
			MC_SIDE: side,
		},
	});

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

	rmSync(LOGOUT_FLAG, { force: true });
	for (const name of SIDE_LAYERS) {
		rmSync(pidFile(name), { force: true });
		const sideEnv = { ...process.env, XIAOKE_LAUNCHER_PID: String(process.pid), XIAOKE_RESUME: sessions[name] };
		if (argv.includes("--headless")) {
			spawn(process.execPath, [join(ROOT, "scripts", "start.mjs"), `--${name}`], {
				stdio: ["ignore", "inherit", "inherit"], windowsHide: true, env: sideEnv,
			});
			continue;
		}
		spawn("cmd.exe", ["/d", "/c", `start "xiaoke-${name}" "${process.execPath}" "${join(ROOT, "scripts", "start.mjs")}" --${name}`], {
			windowsVerbatimArguments: true, stdio: "ignore", windowsHide: true,
			env: sideEnv,
		});
	}

	const controller = runAgy();
	let closing = false;
	let stopped = false;
	const stop = async code => {
		if (stopped) return; stopped = true; closing = true;
		clearInterval(watch);
		for (const name of SIDE_LAYERS) { try { const pid = Number(readFileSync(pidFile(name), "utf8")); if (pid) process.kill(pid); } catch {} }
		await sleep(300);
		ear.kill(); body.kill();
		await sleep(500);
		try {
			if (finishRun()) {
				console.log("\n把这一局的日志传到服务器上……");
				const sent = await Promise.race([pushRuns(), sleep(60000).then(() => { throw new Error("一分钟还没传完"); })]);
				if (sent.length) console.log(`传好了：${sent.join("、")}`);
			}
		} catch (e) {
			console.warn(`日志没传上去（${e.message}），留在 logs/runs/ 里，下次下线时一起传。`);
		}
		process.exit(code ?? 0);
	};
	const sidePid = {};
	const startedAt = Date.now();
	const watch = setInterval(() => {
		if (closing) return;
		if (existsSync(LOGOUT_FLAG)) {
			closing = true;
			rmSync(LOGOUT_FLAG, { force: true });
			setTimeout(() => controller.kill(), 3000);
			return;
		}
		for (const name of SIDE_LAYERS) {
			if (!sidePid[name] && existsSync(pidFile(name))) sidePid[name] = Number(readFileSync(pidFile(name), "utf8")) || 0;
			if (sidePid[name] && !alive(sidePid[name])) {
				closing = true;
				console.log(`\n${LAYERS[name].name}的窗口关掉了，小克一起下线。`);
				controller.kill();
				return;
			}
			if (!sidePid[name] && Date.now() - startedAt > 30000) {
				closing = true;
				console.log(`\n${LAYERS[name].name}的窗口没能打开，先关掉。`);
				controller.kill();
				return;
			}
		}
	}, 1000);
	controller.on("exit", stop);
	controller.on("error", e => { console.error("启动 Agy 控制器失败：", e.message); stop(1); });
}
