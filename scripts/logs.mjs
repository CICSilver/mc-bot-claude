// 一局的日志归到一处，她下线时传到服务器上，换台电脑要看就拉下来。服务器上只留最近两天的，不进 git。
// 一局一个文件夹 logs/runs/<日期>_<时分>_<main|test>_<登录名>/：
//   ear.log、body.log              这一局耳朵和身体写的那一段（logs/ 里的是一直往后接着写的）
//   analysis.jsonl                 这一局心情的分析日志（每件事前后的数、跨档、心结）。logs/analysis.jsonl 每局开始时清掉，只装这一局的
//   fast.jsonl、exec.jsonl、mind.jsonl  三层各自的会话记录（Claude Code 存在 ~/.claude/projects 下，换台电脑就看不到了）
//   prompt-fast.md 这些             这一局三层用的设定
//   run.json                       什么时候开始和结束、哪台电脑、哪个服、模型和思考强度、两个仓库在哪个提交
// 用法：
//   node scripts/logs.mjs pull     把服务器上的拉到 logs/runs/（看日志、跑 measure.mjs / cost.mjs）
//   node scripts/logs.mjs push     把还没传上去的传上去（她下线时启动器会自己做）
//   node scripts/logs.mjs list     本地和服务器上各有哪几局
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, openSync, readSync, closeSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOGS = join(ROOT, "logs");
const RUNS = join(LOGS, "runs");
const CURRENT = join(LOGS, "run.json");   // 正在跑的这一局：醒来时写下，收尾时搬进它的文件夹
const PROJECTS = join(homedir(), ".claude", "projects");
const KEEP_MS = 2 * 24 * 3600 * 1000;
// 跟耳朵连同一台服务器（scripts/ear-server.mjs）
const SERVER = process.env.MC_SERVER ?? "root@121.4.126.91";
const SSH = process.env.SSH_BIN ?? "ssh";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];
const REMOTE = "~/xiaoke-logs";
// Windows 自带的 tar（Git 里那个 tar 不认 Windows 路径）
const TAR = process.platform === "win32" && existsSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"))
	? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
const LAYERS = ["fast", "exec", "mind"];
// 身体写的心情分析日志（start.mjs 用 XIAOKE_ANALYSIS 告诉身体写到这里）
const ANALYSIS = join(LOGS, "analysis.jsonl");

const size = file => { try { return statSync(file).size; } catch { return 0; } };
const pad = n => String(n).padStart(2, "0");
const stamp = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const commit = dir => { try { return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(); } catch { return ""; } };
const branch = dir => { try { return execFileSync("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", windowsHide: true }).trim(); } catch { return ""; } };

// 醒来时：记下耳朵、身体的日志现在写到哪了。上一局要是没收好尾（直接点 X 关的窗口），先替它收尾
export function beginRun({ side, login, world, layers, mcp }) {
	if (existsSync(CURRENT)) {
		try { finishRun(); } catch (e) { console.warn(`上一局的日志没能收好：${e.message}`); }
	}
	// 心情的分析日志不像 body.log 那样一直往后接：上一局的上面已经收进它的文件夹了，这里清掉，这一局从空的开始。
	// 清不掉（比如被占着）也没关系，下面记下从哪开始，收尾时只拿这一局的那段
	try { rmSync(ANALYSIS, { force: true }); } catch { /* 清不掉就按位置截 */ }
	const started = new Date();
	const run = {
		id: `${stamp(started)}_${side || "unknown"}_${login}`,
		startedAt: started.toISOString(),
		host: hostname(),
		side, login, world, layers,
		commits: { bot: `${branch(ROOT)} ${commit(ROOT)}`, mcp: mcp ? `${branch(mcp)} ${commit(mcp)}` : "" },
		earStart: size(join(LOGS, "ear.log")),
		bodyStart: size(join(LOGS, "body.log")),
		analysisStart: size(ANALYSIS),
	};
	mkdirSync(LOGS, { recursive: true });
	writeFileSync(CURRENT, JSON.stringify(run, null, 2));
	return run;
}

function findTranscript(id) {
	if (!id || !existsSync(PROJECTS)) return null;
	for (const dir of readdirSync(PROJECTS)) {
		const file = join(PROJECTS, dir, `${id}.jsonl`);
		if (existsSync(file)) return file;
	}
	return null;
}

// 从 start 开始到文件末尾那一段
function copyTail(from, to, start) {
	const end = size(from);
	if (end <= start) return writeFileSync(to, "");
	const buf = Buffer.alloc(end - start);
	const fd = openSync(from, "r");
	try { readSync(fd, buf, 0, buf.length, start); } finally { closeSync(fd); }
	writeFileSync(to, buf);
}

// 收尾：这一局的东西都搬进 logs/runs/<id>/
export function finishRun() {
	if (!existsSync(CURRENT)) return null;
	const run = JSON.parse(readFileSync(CURRENT, "utf8"));
	const dir = join(RUNS, run.id);
	mkdirSync(dir, { recursive: true });
	copyTail(join(LOGS, "ear.log"), join(dir, "ear.log"), run.earStart ?? 0);
	copyTail(join(LOGS, "body.log"), join(dir, "body.log"), run.bodyStart ?? 0);
	// 心情关着时身体不写分析日志，就不放空文件
	if (existsSync(ANALYSIS)) copyTail(ANALYSIS, join(dir, "analysis.jsonl"), run.analysisStart ?? 0);
	let sessions = {};
	try { sessions = JSON.parse(readFileSync(join(LOGS, "sessions.json"), "utf8")); } catch { /* 没有 */ }
	const missing = [];
	for (const layer of LAYERS) {
		const file = findTranscript(sessions[layer]);
		if (file) copyFileSync(file, join(dir, `${layer}.jsonl`));
		else if (sessions[layer]) missing.push(layer);
		const prompt = join(LOGS, `prompt-${layer}.md`);
		if (existsSync(prompt)) copyFileSync(prompt, join(dir, `prompt-${layer}.md`));
	}
	writeFileSync(join(dir, "run.json"), JSON.stringify({ ...run, endedAt: new Date().toISOString(), sessions, missing }, null, 2));
	rmSync(CURRENT, { force: true });
	return dir;
}

function run(cmd, args, { cwd, input, output } = {}) {
	return new Promise(resolvePromise => {
		const p = spawn(cmd, args, { cwd, stdio: [input ? "pipe" : "ignore", output ? "pipe" : "ignore", "pipe"], windowsHide: true });
		let err = "";
		p.stderr.on("data", d => { err += d; });
		p.on("error", e => resolvePromise({ code: -1, err: e.message, p }));
		p.on("exit", code => resolvePromise({ code, err: err.trim() }));
		if (input) input(p);
		if (output) output(p);
	});
}

// 一端的 tar 接到另一端的 tar，中间是 ssh
async function pipe(fromCmd, fromArgs, fromCwd, toCmd, toArgs, toCwd) {
	let to;
	const receiving = run(toCmd, toArgs, { cwd: toCwd, input: p => { to = p; } });
	const sending = run(fromCmd, fromArgs, { cwd: fromCwd, output: p => p.stdout.pipe(to.stdin) });
	const [a, b] = await Promise.all([sending, receiving]);
	if (a.code !== 0 || b.code !== 0) throw new Error((a.err || b.err || `退出代码 ${a.code}/${b.code}`).split("\n").slice(-2).join(" "));
}

const ended = dir => {
	try { return Date.parse(JSON.parse(readFileSync(join(RUNS, dir, "run.json"), "utf8")).endedAt) || statSync(join(RUNS, dir)).mtimeMs; } catch { return statSync(join(RUNS, dir)).mtimeMs; }
};
const localRuns = () => (existsSync(RUNS) ? readdirSync(RUNS).filter(n => existsSync(join(RUNS, n, "run.json"))) : []);

// 两天前的本地文件夹删掉（原来的 logs/*.log 和 ~/.claude 里的会话记录不动）
function pruneLocal() {
	for (const name of localRuns()) if (Date.now() - ended(name) > KEEP_MS) rmSync(join(RUNS, name), { recursive: true, force: true });
}

// 把还没传的传上去，服务器上两天前的删掉
export async function pushRuns() {
	pruneLocal();
	const pending = localRuns().filter(n => !existsSync(join(RUNS, n, ".uploaded")));
	const prune = `find ${REMOTE} -mindepth 1 -maxdepth 1 -type d -mmin +${KEEP_MS / 60000} -exec rm -rf {} +`;
	if (!pending.length) return [];
	await pipe(TAR, ["-czf", "-", ...pending], RUNS, SSH, [...SSH_OPTS, SERVER, `mkdir -p ${REMOTE} && tar -xzf - -C ${REMOTE} && ${prune}`]);
	for (const name of pending) writeFileSync(join(RUNS, name, ".uploaded"), new Date().toISOString());
	return pending;
}

export async function pullRuns() {
	mkdirSync(RUNS, { recursive: true });
	const before = new Set(localRuns());
	await pipe(SSH, [...SSH_OPTS, SERVER, `mkdir -p ${REMOTE} && tar -czf - -C ${REMOTE} .`], undefined, TAR, ["-xzf", "-"], RUNS);
	const got = localRuns().filter(n => !before.has(n));
	for (const name of localRuns()) if (!existsSync(join(RUNS, name, ".uploaded"))) writeFileSync(join(RUNS, name, ".uploaded"), "pulled");
	return got;
}

async function listRemote() {
	let out = "";
	const r = await run(SSH, [...SSH_OPTS, SERVER, `mkdir -p ${REMOTE} && ls -1 ${REMOTE}`], { output: p => p.stdout.on("data", d => { out += d; }) });
	if (r.code !== 0) throw new Error(r.err || `退出代码 ${r.code}`);
	return out.split("\n").map(s => s.trim()).filter(Boolean);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
	const what = process.argv[2] ?? "list";
	try {
		if (what === "push") {
			const sent = await pushRuns();
			console.log(sent.length ? `传上去了：${sent.join("、")}` : "没有要传的");
		} else if (what === "pull") {
			const got = await pullRuns();
			console.log(got.length ? `拉下来了：${got.join("、")}（在 logs/runs/）` : "服务器上的本地都有了");
		} else if (what === "list") {
			console.log("本地：", localRuns().map(n => `${n}${existsSync(join(RUNS, n, ".uploaded")) ? "" : "（还没传）"}`).join("、") || "没有");
			console.log("服务器：", (await listRemote()).join("、") || "没有");
		} else {
			console.log("用法：node scripts/logs.mjs pull|push|list");
		}
	} catch (e) {
		console.error(`没连上服务器：${e.message}`);
		process.exit(1);
	}
}
