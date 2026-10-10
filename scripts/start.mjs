// 小克的启动器。小克的脑子分成三层，连着同一个身体：
//   1. 身体：旁边的 Minecraft MCP 以 HTTP 方式常驻（--http-port），三层脑子连同一个机器人
//   2. 耳朵：scripts/ear-server.mjs，把世界里的动静分给三层
//   3. 决策脑：另开一个窗口。默认 GPT-6.1 Sol + high：定打算、重要取舍、设计图纸、掂量请求、整理记忆、下线
//   4. 执行脑：另开一个窗口。默认 GPT-6.1 Sol + low：把决策脑派的活做成，自己安排步骤、处理普通的麻烦
//   5. 快速反应层：就在这个窗口。默认 GPT-6 Luna + low，聊天、社交、即时反应；在这个窗口里打字，就是坐在电脑前的你在跟小克说话
// 关掉任何一个窗口（或者小克自己 logout），其它的都跟着收掉。
// 用法：node scripts/start.mjs [--continue 接着上次的三段对话] [--check 配置检查]
//      node scripts/start.mjs --mind / --exec [--continue]   第 3、4 步自动调用的，不用手动跑
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { childEnv, ensureRuntime, findCodex, layerOptions } from "./codex-config.mjs";
import { assertPortsFree } from "./ports.mjs";
import { copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLayerPrompt, MANUAL_DIR, REFERENCE_DIR } from "./prompt.mjs";
import { refreshReferences } from "./references.mjs";
import { beginRun, finishRun, pushRuns } from "./logs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);

// 身体和小克这个人的配置：登录名、端口、记忆放在哪。路径相对本目录写，换台电脑也能用
const CONFIG = JSON.parse(readFileSync("config/xiaoke-body.json", "utf8"));

// 换模型、思考强度写在 config 的 layers 里；环境变量覆盖本次启动。
// 临时试一下也可以设环境变量 XIAOKE_MIND_MODEL、XIAOKE_EXEC_EFFORT 这些，优先于 config
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
		name: "决策脑",
		...layerOptions("mind", CONFIG),
		wake: "你是拿主意的那一面",
	},
};
// 另开窗口的两层，各记一个进程号
const SIDE_LAYERS = ["mind", "exec"];
const pidFile = name => join(ROOT, "logs", `${name}.pid`);
const EAR_PORT = Number(CONFIG.earPort) || 25599;
const BODY_PORT = Number(process.env.XIAOKE_BODY_PORT) || Number(CONFIG.bodyPort) || 25598;
const BODY_URL = `http://127.0.0.1:${BODY_PORT}`;
const LOGOUT_FLAG = join(ROOT, "logs", "logout.flag");

const argv = process.argv.slice(2);
const layer = argv.includes("--mind") ? "mind" : argv.includes("--exec") ? "exec" : "fast";
const resume = argv.includes("--continue") || argv.includes("-c");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
process.title = `小克 · ${LAYERS[layer].name}`;

const codexExe = findCodex();
ensureRuntime();
if (argv.includes("--login")) {
 const login = spawn(process.execPath, [join(ROOT, "scripts", "codex-login.mjs")], { stdio: "inherit", windowsHide: true });
 login.on("exit", code => process.exit(code ?? 1));
 await new Promise(() => {});
}
const allowedArgs = new Set(["--mind", "--exec", "--continue", "-c", "--check", "--headless"]);
if (argv.some(arg => !allowedArgs.has(arg))) throw new Error("不支持的启动参数；模型和思考强度请使用 config.layers 或环境变量配置。");
if (!argv.includes("--check") && layer === "fast") {
 try { execFileSync(codexExe, ["login", "status"], { env: childEnv(), stdio: "pipe", windowsHide: true }); }
 catch { console.error("请先运行 start-xiaoke.cmd --login，完成机器人专用的 ChatGPT 登录。"); process.exit(1); }
}
// 小克的记忆（memory/）和好感度（state/）放在哪：config 里的 home（默认本目录），也可以用 XIAOKE_HOME 指定
const HOME = resolve(process.env.XIAOKE_HOME || CONFIG.home || ".");
mkdirSync("logs", { recursive: true });
mkdirSync(HOME, { recursive: true });

// 整个文件夹拷过去、删掉。不用 fs.cpSync 和 fs.rmSync 的 recursive：Node 22 以后它们在 Windows 上碰到中文路径
// （哪怕那个文件夹根本不存在），cpSync 会建出一个乱码名字的文件夹，两个都会让整个进程不报错直接退出
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

// home 里还没有记忆（第一次用这个 home，比如测试版的 test-home）：从 memory-blank 的空白记忆开始。
// 已经有了就接着用，不会清掉；想让测试版从头来过，删掉 home 里的 memory 和 state 两个文件夹再启动
function seedMemory() {
	if (existsSync(join(HOME, "memory"))) return;
	copyDir("memory-blank", join(HOME, "memory"));
	for (const name of readdirSync(join(HOME, "memory"))) {
		const file = join(HOME, "memory", name);
		if (name.endsWith(".md")) writeFileSync(file, fill(readFileSync(file, "utf8")));
	}
	console.log(`第一次用 ${HOME}，从 memory-blank 的空白记忆开始。`);
}

// 提示词和空白记忆里的 {{LOGIN}}、{{EAR}} 换成这一次的登录名和耳朵地址
const fill = text => text.replaceAll("{{LOGIN}}", CONFIG.username).replaceAll("{{EAR}}", `ws://127.0.0.1:${EAR_PORT}`);

// 每层由独立控制器保存自己的 Codex thread ID，避免三层并发覆盖会话文件。
const sessions = Object.fromEntries(Object.keys(LAYERS).map(name => [name, resume ? "1" : "0"]));
function runCodex() {
 const L = LAYERS[layer];
 console.log(`${L.name}：${L.model}，思考强度 ${L.effort}，记忆在 ${join(HOME, "memory")}`);
 return spawn(process.execPath, [join(ROOT, "scripts", "codex-layer.mjs"), layer], {
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
  writeFileSync(join(ROOT, "logs", `profile-${name}.json`), JSON.stringify({ provider: "codex", model: LAYERS[name].model, effort: LAYERS[name].effort, promptFile }, null, 2));
 }
}
process.on("SIGINT", () => {});   // Ctrl+C 由本窗口的 Codex 控制器处理

if (layer !== "fast") {
	// ---- 决策脑、执行脑的窗口：跟着快速反应层的启动器走 ----
	const parent = Number(process.env.XIAOKE_LAUNCHER_PID);
	writeFileSync(pidFile(layer), String(process.pid));
	const controller = runCodex();
	let parentGone = false;
	const stop = async code => {
		rmSync(pidFile(layer), { force: true });
		// 这个窗口一退出就关了，出错的话留几秒让人看清楚
		if (code && !parentGone) { console.error(`\n${LAYERS[layer].name}退出了（代码 ${code}），10 秒后关窗口。`); await sleep(10000); }
		process.exit(code ?? 0);
	};
	setInterval(() => {
		if (parent && !alive(parent)) { parentGone = true; controller.kill(); stop(0); }
	}, 1000);
	controller.on("exit", stop);
	controller.on("error", e => { console.error("启动 Codex 控制器失败：", e.message); stop(1); });
} else {
	// ---- 快速反应层的窗口：先把身体、耳朵、另外两层都安排好 ----
	const mcpMain = resolve(CONFIG.mcp, "dist", "main.js");
	if (!existsSync(mcpMain)) {
		console.error(`找不到 ${mcpMain}，先在 ${resolve(CONFIG.mcp)} 里运行 npm install 和 npm run build。`);
		process.exit(1);
	}
	seedMemory();

	preparePrompts();
	if (argv.includes("--check")) { console.log("Codex 可执行文件、三层提示词和配置检查通过；未连接游戏或调用模型。"); process.exit(0); }
	await assertPortsFree([EAR_PORT, BODY_PORT]);
	// 这一局的日志：记下耳朵、身体的日志现在写到哪了，下线时把这一局的那段和三层的会话记录归进 logs/runs/，传到服务器上（scripts/logs.mjs）。
	// 上一局要是直接点 X 关的窗口，它的那份这时候补上，在后台传
	const side = { 正式世界: "main", 测试世界: "test" }[CONFIG.world] ?? "";
	const leftover = existsSync(join(ROOT, "logs", "run.json"));
	beginRun({
		side, login: CONFIG.username, world: CONFIG.world, mcp: resolve(CONFIG.mcp),
		layers: Object.fromEntries(Object.entries(LAYERS).map(([name, L]) => [name, `${L.model} ${L.effort}`])),
	});
	if (leftover) pushRuns().catch(() => {});

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
			// 盖房子的参考：find-inspiration 从这里找，给她看的路径照她在 home 里看到的写（home 不是本目录时，下面会拷一份叫“参考”）
			XIAOKE_REFERENCES: join(ROOT, REFERENCE_DIR),
			XIAOKE_REFERENCES_SHOWN: HOME !== resolve(ROOT) ? "参考" : REFERENCE_DIR,
			// 心情：每件事动多少的表（归你改，下次启动生效）。心情本身存在 state/mood.json，跟好感度放一起
			XIAOKE_MOOD_CONFIG: join(ROOT, "prompts", "小克", "心情.json"),
			// 心情的分析日志（每件事前后的数、跨档），收尾时跟 body.log 一起归进这一局的文件夹（scripts/logs.mjs）
			XIAOKE_ANALYSIS: join(ROOT, "logs", "analysis.jsonl"),
			// config 里写 "mood": false 就关掉心情（〔现在〕不写心情，feel 回“关着”，身体动作跟原来一样）；不写就是开着
			...(CONFIG.mood === false ? { XIAOKE_MOOD: "off" } : {}),
		},
	});

	// 耳朵。AI 同伴（大肥鱼 Moby，测试时还有正式的小克 clawd）不算访客，它们说的话只在有真人在线时才转发
	const earLog = openSync("logs/ear.log", "a");
	const ear = spawn(process.execPath, ["scripts/ear-server.mjs"], {
		stdio: ["ignore", earLog, earLog], detached: true, windowsHide: true,
		env: {
			...process.env,
			EAR_PORT: String(EAR_PORT), MC_BOT_NAME: CONFIG.username, MC_BOT_NICK: CONFIG.nick ?? "小克",
			MC_COMPANIONS: CONFIG.env?.XIAOKE_COMPANIONS ?? "", MC_ALIASES: CONFIG.env?.XIAOKE_ALIASES ?? "", EAR_PARENT_PID: String(process.pid), XIAOKE_BODY_URL: BODY_URL,
			// 耳朵只听这个世界所在的服：正式世界在正式服（main），测试世界在测试服（test）
			MC_SIDE: side,
		},
	});

	// 控制器启动后会连接 MCP，身体先准备好
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

	// 决策脑、执行脑各开一个窗口（start 会给它们新的控制台）
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

	const controller = runCodex();
	let closing = false;
	let stopped = false;
	const stop = async code => {
		if (stopped) return; stopped = true; closing = true;
		clearInterval(watch);
		ear.kill(); body.kill();
		for (const name of SIDE_LAYERS) { try { const pid = Number(readFileSync(pidFile(name), "utf8")); if (pid) process.kill(pid); } catch {} }
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
		// 小克用 logout 下线时，身体会写这个文件：等她说完最后一句就关窗口
		if (existsSync(LOGOUT_FLAG)) {
			closing = true;
			rmSync(LOGOUT_FLAG, { force: true });
			setTimeout(() => controller.kill(), 3000);
			return;
		}
		// 决策脑或执行脑的窗口被关掉了：小克少了一部分脑子，干脆一起下线（另一个窗口看到启动器没了也会自己关）
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
	controller.on("error", e => { console.error("启动 Codex 控制器失败：", e.message); stop(1); });
}
