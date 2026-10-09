// 小克的“体检”：从 Claude Code 的会话记录里算出她被叫醒以后多久回话、想了多少、长活顺不顺，单层和两层的小克可以放在一起比。
// 用法：
//   node scripts/measure.mjs                       最近一次启动的两层（logs/sessions.json）
//   node scripts/measure.mjs --list                列出能找到的小克会话（单层的、快的、慢的）
//   node scripts/measure.mjs <会话号或 .jsonl> ...  指定会话，比如拿以前单层小克的会话和这次的比
// 会话记录在 ~/.claude/projects/<目录>/<会话号>.jsonl：每个事件进来时有一条 enqueue（到达时间），
// 被模型拿去处理时有 dequeue（闲着时直接递过去）或 remove（正忙着，塞进当前这一轮）
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = join(homedir(), ".claude", "projects");
const BOTS = new Set(["Moby", "clawd", "clawd_test"]);   // AI 玩家说的话不算访客的聊天
const NO_REPLY_MS = 180000;

const median = xs => quantile(xs, 0.5);
function quantile(xs, q) {
	if (!xs.length) return NaN;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
const sec = ms => Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)}s` : "-";
const max = xs => xs.length ? Math.max(...xs) : NaN;
const pct = (n, d) => d ? `${Math.round((n / d) * 100)}%` : "-";
const clock = t => new Date(t).toLocaleTimeString("zh-CN", { hour12: false });

function findTranscript(arg) {
	if (arg.endsWith(".jsonl") && existsSync(arg)) return arg;
	// 会话号可以只写开头几位（--list 里看）
	for (const dir of readdirSync(PROJECTS)) {
		const name = readdirSync(join(PROJECTS, dir)).find(n => n.endsWith(".jsonl") && n.startsWith(arg));
		if (name) return join(PROJECTS, dir, name);
	}
	return null;
}

function load(file) {
	const entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => {
		try { return JSON.parse(line); } catch { return null; }
	}).filter(Boolean);
	const firstPrompt = entries.find(e => e.type === "user" && typeof e.message?.content === "string")?.message.content ?? "";
	const layer = firstPrompt.includes("反应快") ? "快速反应层" : firstPrompt.includes("拿主意") ? "决策脑" : firstPrompt.includes("动手做事") ? "执行脑"
		: firstPrompt.includes("慢慢想") ? "思维层" : "单层";
	const assistants = entries.filter(e => e.type === "assistant");
	const model = assistants[0]?.message?.model ?? "?";
	const times = entries.map(e => Date.parse(e.timestamp)).filter(Number.isFinite);
	return { file, id: basename(file, ".jsonl"), entries, firstPrompt, layer, model, start: Math.min(...times), end: Math.max(...times) };
}

function analyze(session) {
	const { entries } = session;
	// 事件：到达（enqueue）和被拿去处理（dequeue / remove）
	const events = [];
	const waiting = [];
	for (const e of entries) {
		if (e.type !== "queue-operation" || !e.content?.includes("<event>")) continue;
		const t = Date.parse(e.timestamp);
		if (e.operation === "enqueue") {
			const body = e.content.match(/<event>([\s\S]*?)<\/event>/)?.[1] ?? "";
			const batch = body.split("\n").filter(Boolean).map(line => {
				const m = line.match(/^\d\d-\d\d \d\d:\d\d \[([^\]]+)\] ?(.*)$/);
				// 快速反应层的事件后面跟着〔现在〕和“这段时间嘴巴那边”，统计时只看事件本身
				const text = (m?.[2] ?? line).split(/　[〔（]/)[0];
				return { arrive: t, pickup: null, kind: m?.[1] ?? "?", text, content: e.content };
			});
			events.push(...batch);
			waiting.push(batch);
		} else {
			const i = waiting.findIndex(b => b[0].content === e.content);
			const batch = waiting.splice(i >= 0 ? i : 0, 1)[0];
			for (const ev of batch ?? []) ev.pickup = t;
		}
	}
	// 工具调用和思考量（同一条回复会拆成好几行记录，按 message.id 去重）
	const tools = [];
	const seen = new Set();
	let thinking = 0, output = 0, replies = 0;
	for (const e of entries) {
		if (e.type !== "assistant") continue;
		const t = Date.parse(e.timestamp);
		for (const c of e.message?.content ?? []) {
			if (c.type === "tool_use") tools.push({ t, name: c.name.replace(/^mcp__minecraft__/, ""), input: c.input });
		}
		const id = e.message?.id;
		if (id && !seen.has(id)) {
			seen.add(id);
			replies++;
			output += e.message.usage?.output_tokens ?? 0;
			thinking += e.message.usage?.output_tokens_details?.thinking_tokens ?? 0;
		}
	}
	const progressTexts = [];
	for (const e of entries) {
		if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
		for (const c of e.message.content) {
			if (c.type !== "tool_result") continue;
			const text = JSON.stringify(c.content ?? "");
			if (/did not work out|not enough materials|Did not start/.test(text)) progressTexts.push(text);
		}
	}
	const chatsAt = tools.filter(x => x.name === "send-chat").map(x => x.t);
	const nextChat = t => chatsAt.find(c => c >= t);

	// 访客说话以后多久回
	const chats = events.filter(ev => ev.kind === "聊天" && !BOTS.has(ev.text.split(":")[0].trim()));
	const latency = [], busyLatency = [], idleLatency = [], slowest = [];
	let unanswered = 0;
	for (const ev of chats) {
		const reply = nextChat(ev.arrive);
		if (reply === undefined || reply - ev.arrive > NO_REPLY_MS) { unanswered++; continue; }
		const ms = reply - ev.arrive;
		latency.push(ms);
		// 这句话到了以后、回话之前，她在用哪些工具
		const between = tools.filter(x => x.t >= ev.arrive && x.t < reply).map(x => x.name);
		slowest.push({ ms, at: ev.arrive, text: ev.text, between });
		// 到了以后过了 1 秒以上才被拿去处理，说明她那时正在想别的、做别的
		(ev.pickup && ev.pickup - ev.arrive > 1000 ? busyLatency : idleLatency).push(ms);
	}
	// 记下来的事多久有回音（思维层）
	const notes = events.filter(ev => ev.kind === "记下");
	const noteReply = notes.map(ev => nextChat(ev.arrive)).map((r, i) => r === undefined ? NaN : r - notes[i].arrive).filter(Number.isFinite);
	const pickupWait = events.filter(ev => ev.pickup).map(ev => ev.pickup - ev.arrive);
	const byKind = {};
	for (const ev of events) byKind[ev.kind] = (byKind[ev.kind] ?? 0) + 1;
	const count = name => tools.filter(x => x.name === name).length;
	const progress = events.filter(ev => ev.kind === "进展");
	return {
		minutes: (session.end - session.start) / 60000,
		events: events.length, byKind,
		chats: chats.length, latency, busyLatency, idleLatency, unanswered,
		slowest: slowest.sort((a, b) => b.ms - a.ms).slice(0, 3),
		notes: notes.length, noteReply,
		pickupWait,
		tools: tools.length, sendChat: chatsAt.length,
		replies, thinking, output,
		builds: count("build-blueprint") + count("build-house"), surveys: count("survey-terrain"), sharePlan: count("share-plan"), noteForLater: count("note-for-later"),
		buildIssues: progress.filter(ev => /did not work out|got hurt|a .* showed up/.test(ev.text)).length + progressTexts.length,
		jobsDone: progress.filter(ev => /: all done/.test(ev.text)).length, jobs: progress.length,
	};
}

function report(sessions) {
	const rows = [
		["会话", s => s.id.slice(0, 8)],
		["哪一层", s => s.layer],
		["模型", s => s.model.replace(/^claude-/, "")],
		["时间", s => `${new Date(s.start).toLocaleDateString("zh-CN")} ${clock(s.start)}～${clock(s.end)}（${s.m.minutes.toFixed(0)} 分钟）`],
		["事件", s => `${s.m.events} 条 ${Object.entries(s.m.byKind).map(([k, n]) => `${k}${n}`).join(" ")}`],
		["访客说话", s => `${s.m.chats} 条，没回 ${s.m.unanswered} 条`],
		["回话：中位 / 90% / 最慢", s => `${sec(median(s.m.latency))} / ${sec(quantile(s.m.latency, 0.9))} / ${sec(max(s.m.latency))}`],
		["10 秒内回的", s => pct(s.m.latency.filter(x => x <= 10000).length, s.m.latency.length)],
		["她闲着时来的：中位", s => `${sec(median(s.m.idleLatency))}（${s.m.idleLatency.length} 条）`],
		["她正忙时来的：中位", s => `${sec(median(s.m.busyLatency))}（${s.m.busyLatency.length} 条）`],
		["事件排队等处理：中位 / 最长", s => `${sec(median(s.m.pickupWait))} / ${sec(max(s.m.pickupWait))}`],
		["[记下] 到回话：中位", s => s.m.notes ? `${sec(median(s.m.noteReply))}（${s.m.notes} 条）` : "-"],
		["每次回复的思考 token：平均", s => s.m.replies ? `${Math.round(s.m.thinking / s.m.replies)}（共 ${s.m.thinking}）` : "-"],
		["工具调用 / 发言", s => `${s.m.tools} / ${s.m.sendChat}`],
		["盖东西 / 看地形", s => `${s.m.builds} / ${s.m.surveys}`],
		["长活：做完 / 总共 / 出问题", s => `${s.m.jobsDone} / ${s.m.jobs} / ${s.m.buildIssues}`],
		["share-plan / note-for-later", s => `${s.m.sharePlan} / ${s.m.noteForLater}`],
	];
	const width = Math.max(...rows.map(([label]) => [...label].length)) + 2;
	for (const [label, get] of rows) {
		const pad = " ".repeat(width - [...label].length);
		console.log(`${label}${pad}${sessions.map(s => get(s)).join("  │  ")}`);
	}
	for (const s of sessions) {
		if (!s.m.slowest.length) continue;
		console.log(`
${s.id.slice(0, 8)}（${s.layer}）回得最慢的几次：`);
		for (const x of s.m.slowest) {
			const steps = x.between.length ? x.between.join(" → ") : "没调工具，一直在想";
			console.log(`  ${clock(x.at)} 等了 ${sec(x.ms)}「${x.text.slice(0, 30)}」 中间：${steps}`);
		}
	}
}

function listSessions() {
	const found = [];
	for (const dir of readdirSync(PROJECTS)) {
		if (!/mc-bot/i.test(dir)) continue;
		for (const name of readdirSync(join(PROJECTS, dir))) {
			if (!name.endsWith(".jsonl")) continue;
			const file = join(PROJECTS, dir, name);
			const head = readFileSync(file, "utf8").slice(0, 200000);
			if (!head.includes("小克醒来啦")) continue;
			const s = load(file);
			found.push({ ...s, size: statSync(file).size });
		}
	}
	found.sort((a, b) => a.start - b.start);
	for (const s of found) {
		console.log(`${s.id}  ${new Date(s.start).toLocaleDateString("zh-CN")} ${clock(s.start)}～${clock(s.end)}  ${s.layer.padEnd(5, "　")}  ${s.model}  ${basename(dirname(s.file))}`);
	}
}

const args = process.argv.slice(2);
if (args.includes("--list")) {
	listSessions();
} else {
	// 一局的文件夹（logs/runs/...，scripts/logs.mjs 归的）：看里面快速反应层和决策脑的会话记录
	let ids = args.flatMap(a => (existsSync(join(a, "run.json")) ? ["fast", "mind"].map(l => join(a, `${l}.jsonl`)).filter(f => existsSync(f)) : [a]));
	if (!ids.length) {
		const saved = JSON.parse(readFileSync(join(ROOT, "logs", "sessions.json"), "utf8"));
		ids = [saved.fast, saved.mind].filter(Boolean);
	}
	const sessions = [];
	for (const id of ids) {
		const file = findTranscript(id);
		if (!file) { console.error(`找不到会话 ${id}`); continue; }
		const s = load(file);
		sessions.push({ ...s, m: analyze(s) });
	}
	if (sessions.length) report(sessions);
}
