// 一局里每一层各发了多少次请求、读写了多少 token，按 API 价粗算花了多少；慢的那一面 / 决策脑、执行脑的请求再按用途分一分。
// 用法：
//   node scripts/cost.mjs                              最近一次启动的几层（logs/sessions.json）
//   node scripts/cost.mjs mind=6cae2fab fast=67a1112e   指定会话（会话号可以只写开头几位，用 measure.mjs --list 找）
// 订阅登录不是按这个价扣额度，只当几局之间的比例看。
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECTS = join(homedir(), ".claude", "projects");
// 美元 / 每百万 token；写缓存按 5 分钟的价
const PRICE = {
	opus: { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
	sonnet: { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};
const KIND = [
	["派活交接", /^(assign-task|cancel-task|get-tasks|get-task|report-task|save-blueprint|list-blueprints|build-saved-blueprint|do-steps)$/],
	["规划设计", /^(survey-terrain|build-blueprint|share-plan|find-building-spot|explore|gather-blocks|set-reminder|pass-to-mouth|stop-job|pause-job|resume-job)$/],
	["走路", /^(move-to-position|look-at|follow-player|accompany-player)$/],
	["搬东西和合成", /^(store-item|take-item|open-container|craft-item|equip-item|place-block|dig-block|pick-up-items|drop-item|smelt-item|take-from-furnace|eat|sleep-in-bed|wake-up|use-item)$/],
	["看看查查", /^(get-|list-|find-|look-around|read-chat|can-craft)/],
	["记忆读写", /^(Read|Write|Edit|Glob|Grep)$/],
	["其它", /./],
];

function findTranscript(id) {
	for (const dir of readdirSync(PROJECTS)) {
		const name = readdirSync(join(PROJECTS, dir)).find(n => n.endsWith(".jsonl") && n.startsWith(id));
		if (name) return join(PROJECTS, dir, name);
	}
	return null;
}

const args = process.argv.slice(2);
const sessions = args.length
	? Object.fromEntries(args.map(a => a.split("=")))
	: JSON.parse(readFileSync(join(ROOT, "logs", "sessions.json"), "utf8"));

let total = 0;
for (const layer of ["mind", "exec", "fast"]) {
	if (!sessions[layer]) continue;
	const file = findTranscript(sessions[layer]);
	if (!file) { console.log(`\n== ${layer}：找不到会话 ${sessions[layer]}`); continue; }
	const turns = [];
	const seen = new Set();
	let model = "";
	for (const line of readFileSync(file, "utf8").split("\n")) {
		let m; try { m = JSON.parse(line); } catch { continue; }
		if (m.type !== "assistant" || !m.message?.usage) continue;
		const id = m.message.id;
		const tools = (m.message.content ?? []).filter(c => c.type === "tool_use").map(c => c.name.replace("mcp__minecraft__", ""));
		if (seen.has(id)) { turns.at(-1).tools.push(...tools); continue; }   // 同一次回复拆成好几行
		seen.add(id);
		model ||= m.message.model ?? "";
		const u = m.message.usage;
		turns.push({ input: u.input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, output: u.output_tokens ?? 0, tools });
	}
	const sum = k => turns.reduce((n, t) => n + t[k], 0);
	const price = PRICE[/opus/.test(model) ? "opus" : "sonnet"];
	const usd = Object.keys(price).reduce((n, k) => n + sum(k) * price[k], 0) / 1e6;
	total += usd;
	console.log(`\n== ${layer}（${model || "?"}）：${turns.length} 次请求，输入 ${sum("input")}，读缓存 ${sum("cacheRead")}，写缓存 ${sum("cacheWrite")}，输出 ${sum("output")}，约 ${usd.toFixed(2)} 美元`);
	if (!turns.length) continue;
	console.log(`平均每次请求读缓存 ${Math.round(sum("cacheRead") / turns.length)} 个 token（每次被叫醒都把整段上下文再读一遍）`);
	if (layer === "fast") continue;
	const byKind = new Map();
	for (const t of turns) {
		const kind = t.tools.length ? KIND.find(([, rx]) => t.tools.every(n => rx.test(n)) || rx.test(t.tools[0]))[0] : "纯思考/说话";
		const k = byKind.get(kind) ?? { n: 0, cacheRead: 0, output: 0 };
		k.n++; k.cacheRead += t.cacheRead; k.output += t.output;
		byKind.set(kind, k);
	}
	for (const [kind, k] of [...byKind].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${kind}：${k.n} 次请求，读缓存 ${k.cacheRead}，输出 ${k.output}`);
}
console.log(`\n一共约 ${total.toFixed(2)} 美元（API 价粗算）`);
