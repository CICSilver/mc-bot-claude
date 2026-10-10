// 小克的耳朵：连上 MC 服务器读日志，把游戏事件通过本机 WebSocket 推给小克（Claude Code 的 Monitor）。
// 每个事件是一条文本消息，格式：月-日 时:分 [类型] 内容
// 小克的脑子分成三层（见 scripts/start.mjs），各连一个地址，耳朵按事件类型分给它们：
// - ws://127.0.0.1:25599/fast  快速反应层：聊天、进出、礼物、注视……来了马上接话。后面附上〔现在〕（问身体要的一行状况）
// - ws://127.0.0.1:25599/exec  执行脑：派来的活、长活结束、危险、天气……把活做成。后面也附上〔现在〕
// - ws://127.0.0.1:25599/mind  决策脑：执行脑的汇报、[记下]、提醒、空闲、下线、心情变了……拿主意。后面附上这段时间快速反应层那边发生的事
// 耳朵也是她跟服务器控制台之间的一根线：身体想冒气泡、喵一声、冒爱心时 POST /effect，耳朵换成调用数据包 xiaoke_fx 的命令（world-fx.mjs）
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";
import { renderEffect, cleanText } from "./world-fx.mjs";

const SERVER = process.env.MC_SERVER ?? "root@121.4.126.91";
const SELF = process.env.MC_BOT_NAME ?? "clawd";
const PORT = Number(process.env.EAR_PORT ?? 25599);
// 身体（以 HTTP 方式常驻的 Minecraft MCP），叫醒快速反应层前问它要一行〔现在〕
const BODY_URL = (process.env.XIAOKE_BODY_URL ?? "http://127.0.0.1:25598").replace(/\/+$/, "");
// 游戏里大家怎么称呼这个 bot，数据包召唤 / 下线时 say 的话里会带上它
const NICK = process.env.MC_BOT_NICK ?? "小克";
// 同一个服务器上的其它 AI 玩家（逗号分隔的登录名）：不算访客；它们说的话只在有真人在线时才转发，而且限频，免得两个 bot 互相唤醒停不下来
const COMPANIONS = new Set((process.env.MC_COMPANIONS ?? "").split(",").map(s => s.trim()).filter(Boolean));
const COMPANION_CHAT_MS = Number(process.env.COMPANION_CHAT_SECONDS ?? 60) * 1000;
const isBot = who => who === SELF || COMPANIONS.has(who);
// 她的名字：聊天里带上就是在叫她。只认她自己的：昵称（测试号是“小克test”）、去掉 test 的昵称、登录名。
// 10-09：以前还写死了“小克”、把登录名去掉 _test 也算，测试号 clawd_test 就把正式号的 clawd 当成了自己，访客叫正式的 clawd 时测试号也以为在叫她
export function myNames(nick, login) {
	return [...new Set([nick, nick.replace(/test$/i, ""), login].map(n => n.trim().toLowerCase()))].filter(n => n.length >= 2);
}
const MY_NAMES = myNames(NICK, SELF);
// 聊天里有没有叫她的名字。别人的登录名里含着她的名字（正式号 clawd、测试号 clawd_test）时，先把别人的名字抹掉再找，
// 免得访客叫 clawd_test 时正式的 clawd 也以为在叫她
export function mentionsMe(text, names, others = []) {
	let t = text.toLowerCase();
	const longer = [...new Set(others.map(o => o.toLowerCase()))].filter(o => !names.includes(o) && names.some(n => o.includes(n)));
	for (const other of longer.sort((a, b) => b.length - a.length)) t = t.replaceAll(other, " ");
	return names.some(n => t.includes(n));
}
// 别人的别名（admin=CICSilver）：聊天里叫“admin”就是在跟 CICSilver 说
const ALIASES = Object.fromEntries((process.env.MC_ALIASES ?? "").split(",").map(s => s.split("=").map(x => x.trim())).filter(p => p.length === 2 && p[0] && p[1]));
// 有人在线、决策脑却闲了一阵（这一轮结束后没再动，也没在干长活），就叫醒它一次（[空闲]），间隔每次在这个范围里随机。
// 快速反应层那边的聊天不算决策脑的动静
const IDLE_MIN_MS = Number(process.env.IDLE_MIN_SECONDS ?? 60) * 1000;
const IDLE_MAX_MS = Number(process.env.IDLE_MAX_SECONDS ?? 150) * 1000;
// 快速反应层那边一直热闹、决策脑这么久没被叫醒过，就叫它回顾一下（[回顾]）
const REVIEW_MS = Number(process.env.REVIEW_MINUTES ?? 4) * 60 * 1000;
// 世界里只剩小克一个人这么久，就提醒她收拾收拾下线（[独处]）
const ALONE_MS = Number(process.env.ALONE_LOGOUT_MINUTES ?? 30) * 60 * 1000;
// 启动器的进程号：它没了（窗口被直接关掉），耳朵也退出
const PARENT_PID = Number(process.env.EAR_PARENT_PID) || 0;
const SSH = process.env.SSH_BIN ?? "ssh";
// 要连哪个服：main（正式服）或 test（测试服），启动器按 config 的 world 给。服务器上两个服共用一个入口、同一时间只开一个，
// 开着的是谁、目录和控制台在哪，都问服务器上的 mc-active。开着的不是这个就听不到、也不发效果，免得正式小克听到测试服的聊天，
// 或者把气泡发到别的世界去。不给就是“开着哪个算哪个”
const SIDE = process.env.MC_SIDE ?? "";
// 服务器上 MC 的目录（检查数据包和 server.properties 用）：开着的那个服的
const SERVER_DIR = process.env.MC_SERVER_DIR ? `'${process.env.MC_SERVER_DIR}'` : `$(mc-active dir ${SIDE})`;
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];
// 测试（scripts/ear-review.test.mjs）只拿这里导出的几个判断函数用：EAR_TEST=1 时不开端口、不连服务器、不起定时器
const LIVE = process.env.EAR_TEST !== "1";
const every = (fn, ms) => { if (LIVE) setInterval(fn, ms); };

// 玩家在队伍里时，日志里的名字会带上队伍前缀，比如 “[小克] clawd”
const NAME = "(?:\\[[^\\]]*\\] )?([A-Za-z0-9_]{1,16})";
const RE_CHAT = /^(\[Not Secure\] )?<([^>]*)> (.*)$/;
const NICK_RE = NICK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const RE_SUMMON = new RegExp(`^(?:\\[Not Secure\\] )?\\[([A-Za-z0-9_]{1,16})\\] 召唤了${NICK_RE}`);   // 数据包 summon 函数里的 say
const RE_LOGOUT = new RegExp(`^(?:\\[Not Secure\\] )?\\[([A-Za-z0-9_]{1,16})\\] 让${NICK_RE}下线休息啦`);   // 数据包 logout_request 函数里的 say
const RE_JOIN = new RegExp(`^${NAME} joined the game$`);
const RE_LEFT = new RegExp(`^${NAME} left the game$`);
const RE_ADV = new RegExp(`^${NAME} has (made the advancement|completed the challenge|reached the goal) `);
const RE_DEATH = new RegExp(`^${NAME} (was |drowned|fell |hit the ground|burned|went up in flames|went off|tried to swim|blew up|starved|suffocated|died|froze|walked into|experienced kinetic|withered|discovered the floor|didn't want|left the confines)`);

// 哪类事件叫醒哪一层。快速反应层管嘴巴和社交，执行脑管把活做成，决策脑管打算、取舍和记忆
const FAST = "fast", EXEC = "exec", MIND = "mind";
const NAMES = { [FAST]: "快速反应层", [EXEC]: "执行脑", [MIND]: "决策脑" };
const ROUTES = {
	聊天: [FAST], 进服: [FAST], 离开: [FAST], 成就: [FAST], 死亡: [FAST], 礼物: [FAST], 注视: [FAST],
	// 召唤会打断手上的活；危险时身体已经本能地跑开了，嘴巴冒一句，执行脑看看活怎么办
	召唤: [FAST, EXEC], 危险: [FAST, EXEC], 断线: [FAST, EXEC, MIND],
	// 派活、长活结束、下雨雨停：执行脑处理；执行脑的汇报：决策脑拿主意
	任务: [EXEC], 汇报: [MIND],
	// 身体看到的：决策脑在深想（快的那一面可以冒句自言自语）、身边有人却好一会儿没人说话（找个话题聊）
	琢磨: [FAST], 闲聊: [FAST],
	// 决策脑想好了要说的话：聊天框里只有快速反应层一张嘴，托它说出口
	转告: [FAST],
	// 身体注意到的：有人冲她蹲、摸头、挥手、打她（互动），有人动了她的东西、受伤了、拿着鱼、来她家（看见），捉迷藏的进展（游戏）
	互动: [FAST], 看见: [FAST], 游戏: [FAST],
	// 心情变了一档（身体算的，只有说法和原因）：嘴巴冒一句或做个表情，决策脑想想要不要改打算
	心情: [FAST, MIND],
	进展: [EXEC], 天气: [EXEC], 提醒: [MIND], 空闲: [MIND], 记下: [MIND], 下线: [MIND], 独处: [MIND], 回顾: [MIND],
};

const online = new Set();      // 在线的真人访客
const companionsOnline = new Set();
const clients = { [FAST]: new Set(), [EXEC]: new Set(), [MIND]: new Set() };
const pending = { [FAST]: [], [EXEC]: [], [MIND]: [] };   // 那一层没在听时攒下的事件，等它连上再一起给
// 只叫醒了快速反应层的事（还有小克自己在聊天里说的话、旁听到的话），攒着，下次叫醒决策脑时一起给它看。每条是 { text, overheard }
const digest = [];
// 旁边的人在聊、不是对她说的话：不叫醒谁，下次叫醒快速反应层时附在后面（3 分钟内的，最多 6 句），给过一次就清掉
const overheard = [];
// 谁在跟她说话、她什么时候回过：接着聊的判断用
let lastAddressed = null;   // { who, at }
let lastSaidAt = 0;
let lastMindAt = Date.now();
// 给快速反应层、执行脑的事件要先问身体要〔现在〕，各排一队免得顺序乱
const queues = { [FAST]: Promise.resolve(), [EXEC]: Promise.resolve() };
let idleWait = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
let journal = null;   // 读服务器日志的 ssh 进程，耳朵退出时一起关掉
let busyUntil = 0;    // 小克在做后台长活（砍树、钓鱼、探险……）时不发 [空闲]，做完会有 [进展] 叫醒她
let aloneSince = Date.now();   // 从什么时候起没有别人在线（有人在线时是 null）
let aloneWarned = false;

const pad = n => String(n).padStart(2, "0");
const ts = () => { const d = new Date(); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const onlineText = () => (online.size ? `在线：${[...online].join(" ")}` : "现在没有其他人在线")
	+ (companionsOnline.size ? `（AI 同伴在线：${[...companionsOnline].join(" ")}）` : "");
const listening = () => clients[FAST].size + clients[EXEC].size + clients[MIND].size;

function frame(text) {
	const payload = Buffer.from(text, "utf8");
	let header;
	if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
	else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
	else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
	return Buffer.concat([header, payload]);
}

// 告诉身体决策脑 / 执行脑这一轮开始了（一轮结束由它们的 Stop hook 直接告诉身体）
function turnStarted(layer) {
	fetch(`${BODY_URL}/mind-state?layer=${layer}`, {
		method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: true }), signal: AbortSignal.timeout(1000),
	}).catch(() => {});
}

function deliver(layer, text) {
	if (layer === MIND) lastMindAt = Date.now();
	if (layer !== FAST && clients[layer].size) turnStarted(layer);
	if (clients[layer].size === 0) {
		pending[layer].push(text);
		if (pending[layer].length > 50) pending[layer].shift();
	}
	for (const socket of clients[layer]) socket.write(frame(text));
}

// ---- 给决策脑看的“这段时间嘴巴那边” ----
// overheard 的是旁边的人互相在聊、不是对她说的（[旁听]）。10-09：不是对她说的话不叫醒任何一层（也不花额度），
// 所以它们只在决策脑因为别的事醒来时顺带给它看，自己不算“嘴巴那边一直热闹”，不触发 [回顾]
const DIGEST_MAX = 40, DIGEST_CHARS = 3000, DIGEST_OVERHEARD_MAX = 12;
export function addToDigest(entries, text, overheard = false) {
	entries.push({ text: text.length > 200 ? `${text.slice(0, 200)}…` : text, overheard });
	// 太多了先丢最早的 [旁听]：它们不叫醒决策脑、攒得久，别让别人一直在聊把嘴巴那边真发生的事挤掉
	const tooMany = () => entries.length > DIGEST_MAX || entries.map(e => e.text).join(" ／ ").length > DIGEST_CHARS
		|| entries.filter(e => e.overheard).length > DIGEST_OVERHEARD_MAX;
	while (tooMany()) {
		const i = entries.findIndex(e => e.overheard);
		entries.splice(i >= 0 ? i : 0, 1);
	}
}
export function formatDigest(entries) {
	if (!entries.length) return "";
	const note = entries.some(e => e.overheard) ? "。标着 [旁听] 的是旁边的人互相在聊，不是对你说的，嘴巴也没接话" : "";
	return `　（这段时间嘴巴那边：${entries.map(e => e.text).join(" ／ ")}${note}）`;
}
// 该不该叫决策脑 [回顾]：嘴巴那边真跟人打过交道（只有 [旁听] 不算），决策脑又有这么久没被叫醒了
export function reviewDue(entries, sinceMindMs, reviewMs = REVIEW_MS) {
	return sinceMindMs >= reviewMs && entries.some(e => !e.overheard);
}

function remember(entry, overheard = false) {
	addToDigest(digest, entry, overheard);
}

function takeDigest() {
	return formatDigest(digest.splice(0));
}

async function withSnapshot(line, layer) {
	let text = line;
	if (layer === FAST) {
		const recent = overheard.splice(0).filter(o => Date.now() - o.at < 180000).slice(-6).map(o => o.line);
		if (recent.length) text += `　（刚才旁边的人在聊，不是对你说的：${recent.join(" ／ ")}）`;
	}
	try {
		const res = await fetch(`${BODY_URL}/snapshot`, { signal: AbortSignal.timeout(800) });
		if (res.ok) return `${text}　${await res.text()}`;
	} catch {
		// 身体还没起来或者卡住了，就只发事件本身
	}
	return text;
}

// 一句话是不是在跟她说（10-09 用户：她跟朋友聊天时，她以为在跟她说话）。返回 { to: true/false, why }：
// - 只有说话的人和她在线（AI 同伴也算别人）：都是跟她说
// - 叫了她的名字：是
// - 点了别的在线玩家的名字或者别名：不是，在跟那个人说
// - 说话时（或者之前 3 秒内）在 16 格内看着她：是（打字的时候视角是定住的，看着谁多半就是跟谁说）
// - 她 30 秒内刚回过这个人：接着聊，是
// - 别的都当成在跟别人说话
async function addressedToMe(who, text) {
	const others = [...online].filter(n => n !== who).length + companionsOnline.size;
	if (!others) return { to: true, why: "" };
	const t = text.toLowerCase();
	if (mentionsMe(text, MY_NAMES, [...online, ...companionsOnline, ...COMPANIONS])) return { to: true, why: "" };
	const named = [...online, ...companionsOnline].filter(n => n !== who && t.includes(n.toLowerCase()))
		.concat(Object.entries(ALIASES).filter(([alias, real]) => real !== who && t.includes(alias.toLowerCase())).map(([, real]) => real));
	if (named.length) return { to: false, why: `在跟 ${named[0]} 说` };
	try {
		const res = await fetch(`${BODY_URL}/gaze?who=${encodeURIComponent(who)}`, { signal: AbortSignal.timeout(800) });
		const g = res.ok ? await res.json() : {};
		if (typeof g.sinceMs === "number" && g.sinceMs <= 3000 && (g.distance ?? 99) <= 16) return { to: true, why: "看着你说的" };
	} catch {
		// 问不到身体就只看名字和接话
	}
	if (lastAddressed?.who === who && lastSaidAt > lastAddressed.at && Date.now() - lastSaidAt < 30000) return { to: true, why: "接着刚才跟你的话" };
	return { to: false, why: "没叫你，也没看着你" };
}
let chatQueue = Promise.resolve();
function visitorChat(who, text) {
	chatQueue = chatQueue.then(async () => {
		const { to, why } = await addressedToMe(who, text);
		if (to) {
			lastAddressed = { who, at: Date.now() };
			emit("聊天", `${who}: ${text}${why ? `（${why}）` : ""}`);
			return;
		}
		console.log(`${ts()} [旁听] ${who}: ${text}（${why}）`);
		overheard.push({ at: Date.now(), line: `${who}: ${text}` });
		if (overheard.length > 12) overheard.shift();
		remember(`${ts().slice(6)} [旁听] ${who}: ${text}（${why}）`, true);   // 决策脑下次醒来顺带看看，不为它叫醒决策脑
	}).catch(e => console.log(`${ts()} 分聊天出错：${e}`));
}

// 身体提醒快速反应层开口的事件：没人在听就算了，过时的不攒着，也不算进决策脑要看的“这段时间”
const NUDGES = new Set(["琢磨", "闲聊"]);
// 决策脑自己托出去的话，不用再给它看一遍；快速反应层真说出口的那句会以“你: ……”出现在“这段时间”里
const FROM_MIND = new Set(["转告"]);
// 只留在快速反应层的事：有人盯着她看，嘴巴瞄一眼、冒一句就完了，不给决策脑看（10-09 用户定的）
const FAST_ONLY = new Set(["注视"]);

function emit(kind, body, to = ROUTES[kind]) {
	if (NUDGES.has(kind) && !clients[FAST].size) return;
	const line = `${ts()} [${kind}] ${body}`;
	console.log(`${line}  → ${to.join("+")}`);
	if (to.includes(MIND)) deliver(MIND, line + takeDigest());
	// 只叫醒了快速反应层的事，攒着给决策脑看；执行脑那边的事它从 [汇报] 里知道
	else if (to.includes(FAST) && !NUDGES.has(kind) && !FROM_MIND.has(kind) && !FAST_ONLY.has(kind)) remember(line.slice(6));   // 去掉日期，只留时:分
	for (const layer of [FAST, EXEC]) {
		if (!to.includes(layer)) continue;
		queues[layer] = queues[layer].then(() => withSnapshot(line, layer)).then(text => deliver(layer, text)).catch(e => console.log(`${ts()} 发给${NAMES[layer]}失败：${e}`));
	}
}

// 决策脑闲了多久：问身体（它从 hook 和工具调用知道这一轮结束了没有）；问不到就看多久没给它递过事件
async function mindIdleMs() {
	try {
		const res = await fetch(`${BODY_URL}/mind-state`, { signal: AbortSignal.timeout(800) });
		const state = await res.json();
		// 执行脑手上还有活（或者在干后台长活），决策脑就不算闲着
		return state.jobBusy || state.tasksOpen ? 0 : Number(state.idleMs) || 0;
	} catch {
		return Date.now() - lastMindAt;
	}
}

every(async () => {
	if (!online.size || !clients[MIND].size || Date.now() < busyUntil) return;
	if (await mindIdleMs() < idleWait) return;
	idleWait = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
	emit("空闲", `你有一会儿没动静了。接着过你自己的日子：推进手上的打算，或者看看周围冒个小点子；在等雨停、等天亮也找点小事做。${onlineText()}`);
}, 10 * 1000);

// 同伴 bot 的聊天：没有真人在场就不转发；有真人时最多每 COMPANION_CHAT_MS 叫醒一次，中间攒下的几句合成一条
const companionQueue = [];
let companionChatAt = 0;
let companionTimer = null;
function companionChat(who, text) {
	if (!online.size) return;
	companionQueue.push(`${who}: ${text}`);
	if (companionQueue.length > 5) companionQueue.shift();
	const wait = companionChatAt + COMPANION_CHAT_MS - Date.now();
	if (wait <= 0) flushCompanionChat();
	else companionTimer ??= setTimeout(flushCompanionChat, wait);
}
function flushCompanionChat() {
	companionTimer = null;
	const lines = companionQueue.splice(0);
	if (!lines.length || !online.size) return;
	companionChatAt = Date.now();
	emit("聊天", lines.join(" ／ "));
}

function handleLog(line) {
	const at = line.indexOf("[Server thread/INFO]: ");
	if (at < 0) return;
	const msg = line.slice(at + "[Server thread/INFO]: ".length);
	let m;
	if ((m = msg.match(RE_CHAT))) {
		const who = m[2].split(" ").pop();   // 去掉队伍前缀，只留登录名
		if (COMPANIONS.has(who)) companionChat(who, m[3]);
		else if (who !== SELF) visitorChat(who, m[3]);
		else {
			lastSaidAt = Date.now();
			remember(`${ts().slice(6)} 你: ${m[3]}`);   // 自己说的话（快速反应层说的，决策脑托它说的也在里面），决策脑回顾时要看到前后文
		}
	} else if ((m = msg.match(RE_SUMMON))) {
		emit("召唤", `${m[1]} 用召唤命令把你传送到了身边`);
	} else if ((m = msg.match(RE_LOGOUT))) {
		emit("下线", `${m[1]} 让你今天下线休息了`);
	} else if ((m = msg.match(RE_JOIN))) {
		if (COMPANIONS.has(m[1])) { companionsOnline.add(m[1]); emit("进服", `${m[1]}（AI 同伴）`); return; }
		if (m[1] !== SELF) { online.add(m[1]); aloneSince = null; aloneWarned = false; }
		emit("进服", m[1]);
	} else if ((m = msg.match(RE_LEFT))) {
		if (COMPANIONS.has(m[1])) { companionsOnline.delete(m[1]); emit("离开", `${m[1]}（AI 同伴）`); return; }
		online.delete(m[1]);
		if (!online.size) aloneSince ??= Date.now();
		emit("离开", m[1]);
	} else if (RE_ADV.test(msg)) {
		emit("成就", msg);
	} else if ((m = msg.match(RE_DEATH))) {
		// 自己死了三层都要知道：嘴巴喊一声，执行脑手上的活断了，决策脑重新打算（东西掉了、人回到出生点）
		emit("死亡", msg, m[1] === SELF ? [FAST, EXEC, MIND] : ROUTES.死亡);
	}
}

function ssh(command) {
	return spawn(SSH, [...SSH_OPTS, SERVER, command], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
}

function refreshOnline() {
	return new Promise(resolve => {
		let out = "";
		const p = ssh(`MC_SIDE=${SIDE} mc list`);
		p.stdout.on("data", d => (out += d));
		p.on("close", () => {
			const m = [...out.matchAll(/players online:(.*)/g)].pop();
			online.clear();
			companionsOnline.clear();
			for (const entry of (m?.[1] ?? "").split(",")) {
				const who = entry.trim().split(" ").pop();   // 去掉队伍前缀
				if (COMPANIONS.has(who)) companionsOnline.add(who);
				else if (who && !isBot(who)) online.add(who);
			}
			if (online.size) aloneSince = null;
			else aloneSince ??= Date.now();
			resolve();
		});
	});
}

// 听不到服务器（断线，或者开着的不是要连的服）时每 10 秒再试一次；“听不到了”只说一次，重新听到再说
let deaf = false;
async function follow() {
	await refreshOnline();
	const p = journal = ssh(`mc-active log ${SIDE}`);
	createInterface({ input: p.stdout }).on("line", handleLog);
	// 连上 5 秒还没断，就算听到了（开着的不是要连的服时 mc-active 马上就退出）
	const heard = setTimeout(() => {
		console.log(`${ts()} 已连上服务器日志，${onlineText()}`);
		deaf = false;
	}, 5000);
	p.on("close", () => {
		clearTimeout(heard);
		if (!deaf) emit("断线", `暂时听不到服务器了${SIDE ? `（要连的是${SIDE === "test" ? "测试服" : "正式服"}）` : ""}，10 秒后重连`);
		deaf = true;
		setTimeout(follow, 10000);
	});
}

function handleFrame(socket, buf) {
	const op = buf[0] & 0x0f;
	let len = buf[1] & 0x7f, off = 2;
	if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
	else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
	const mask = buf.subarray(off, off + 4);
	const data = Buffer.from(buf.subarray(off + 4, off + 4 + len)).map((b, i) => b ^ mask[i % 4]);
	if (op === 0x8) { socket.end(Buffer.from([0x88, 0x00])); for (const set of Object.values(clients)) set.delete(socket); }
	else if (op === 0x9 && data.length < 126) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
}

// 小克的 MCP（身体）发来的消息：后台长活结束了（进展）、她给自己定的提醒到了（提醒）、有人扔东西给她（礼物）、下雨雨停（天气）、
// 有人一直盯着她（注视）、怪物太近本能跑开（危险）、快速反应层记下来交给决策脑的事（记下）、决策脑托快速反应层说的话（转告）、
// 决策脑派给执行脑的活（任务）、执行脑回报决策脑（汇报）、心情变了一档（心情）、开始 / 结束忙
function handleMcp(path, body) {
	const data = JSON.parse(body || "{}");
	if (path === "/event" && ["进展", "提醒", "礼物", "天气", "注视", "危险", "记下", "转告", "任务", "汇报", "琢磨", "闲聊", "互动", "看见", "游戏", "心情"].includes(data.kind) && typeof data.text === "string") {
		if (data.kind === "进展") busyUntil = 0;
		emit(data.kind, data.text.slice(0, 1000));
	} else if (path === "/busy") {
		busyUntil = data.busy ? Date.now() + 20 * 60 * 1000 : 0;   // 最多算 20 分钟“在忙”，免得任务卡死后再也不叫她
	} else throw new Error("unknown message");
}

const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const http = createServer((req, res) => {
	// 新的启动器启动前会来请旧的耳朵退出
	if (req.url === "/shutdown") { res.end("bye\n"); setTimeout(() => process.exit(0), 100); return; }
	if (req.method === "POST" && req.url === "/effect") {
		if (!LOCAL_HOSTS.has(req.headers.host ?? "") || !(req.headers["content-type"] ?? "").startsWith("application/json")) {
			res.writeHead(403); res.end("forbidden\n"); return;
		}
		let body = "";
		req.setEncoding("utf8");
		req.on("data", chunk => { if (body.length < 4096) body += chunk; });
		req.on("end", () => {
			let ok = false;
			try { ok = worldEffect(JSON.parse(body || "{}")); } catch { /* 坏的就不发 */ }
			res.writeHead(ok ? 200 : 409); res.end(ok ? "ok\n" : "not sent\n");
		});
		return;
	}
	if (req.method === "POST" && (req.url === "/event" || req.url === "/busy")) {
		// 只收本机身体发来的 JSON：网页能悄悄发 text/plain 表单，也能借 DNS 重绑定换个 Host 摸过来，往小克脑子里塞假事件
		if (!LOCAL_HOSTS.has(req.headers.host ?? "") || !(req.headers["content-type"] ?? "").startsWith("application/json")) {
			res.writeHead(403); res.end("forbidden\n"); return;
		}
		let body = "";
		req.setEncoding("utf8");
		req.on("data", chunk => { if (body.length < 8192) body += chunk; });
		req.on("end", () => {
			try { handleMcp(req.url, body); res.end("ok\n"); }
			catch { res.writeHead(400); res.end("bad request\n"); }
		});
		return;
	}
	res.writeHead(426); res.end("WebSocket only\n");
});
http.on("upgrade", (req, socket) => {
	const key = req.headers["sec-websocket-key"];
	if (!key) return socket.destroy();
	const path = req.url ?? "/";
	const layer = path.startsWith("/mind") ? MIND : path.startsWith("/exec") ? EXEC : FAST;
	const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
	socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
	socket.setNoDelay(true);
	socket.on("data", buf => handleFrame(socket, buf));
	socket.on("close", () => clients[layer].delete(socket));
	socket.on("error", () => clients[layer].delete(socket));
	clients[layer].add(socket);
	console.log(`${ts()} ${NAMES[layer]}开始听了`);
	socket.write(frame(`${ts()} [开始监听] ${onlineText()}`));
	const queued = pending[layer].splice(0);
	for (const line of queued) socket.write(frame(line));
	if (layer !== FAST && queued.length) turnStarted(layer);
});
http.on("error", e => {
	if (e.code === "EADDRINUSE") { console.log(`端口 ${PORT} 已被占用，应该已经有一个耳朵在运行了`); process.exit(0); }
	throw e;
});
if (LIVE) http.listen(PORT, "127.0.0.1", () => {
	mkdirSync("logs", { recursive: true });
	writeFileSync("logs/ear.pid", String(process.pid));
	console.log(`${ts()} ${NICK}（${SELF}）的耳朵在 ws://127.0.0.1:${PORT}/fast、/exec 和 /mind 等着${COMPANIONS.size ? `，AI 同伴：${[...COMPANIONS].join(" ")}` : ""}`);
	follow();
	checkWorldFx();
});
process.on("exit", () => { journal?.kill(); consoleWriter?.kill(); });

// ---- 让别人看见、听见她：气泡、猫叫、粒子 ----
// 通过一根一直开着的 ssh 把命令写进开着的那个服的控制台（mc-active console）。
// 控制台执行的命令默认会以“[Server: ...]”的样子发给在线的管理员，所以要先在 server.properties 里设 broadcast-console-to-ops=false 并重启服务器；
// 启动时检查这一点和数据包 xiaoke_fx 在不在，不满足就不发（XIAOKE_FX=on 强制打开，XIAOKE_FX=off 关掉）
let fxEnabled = false;
let consoleWriter = null;
const fxTimes = [];   // 最近一分钟发过的效果，限流用

function checkWorldFx() {
	if (process.env.XIAOKE_FX === "off") { console.log(`${ts()} 气泡、声音、粒子关着（XIAOKE_FX=off）`); return; }
	if (process.env.XIAOKE_FX === "on") { fxEnabled = true; console.log(`${ts()} 气泡、声音、粒子开着（XIAOKE_FX=on，没检查服务器）`); return; }
	// server.properties 改了以后要重启过才算数。服务器启动时自己会把它重写一遍，所以启动后两分钟内写的也算
	const check = [
		`d=${SERVER_DIR} && [ -n "$d" ] && cd "$d" || { echo side; exit; }`,
		`grep -q '^broadcast-console-to-ops=false' server.properties || { echo props; exit; }`,
		`test -f world/datapacks/xiaoke_fx/pack.mcmeta || { echo pack; exit; }`,
		`pid=$(systemctl show -p MainPID --value $(mc-active unit ${SIDE}))`,
		`[ "$(stat -c %Y server.properties)" -lt "$(( $(date -d "$(ps -o lstart= -p $pid)" +%s) + 120 ))" ] || { echo restart; exit; }`,
		`echo ok`,
	].join("; ");
	let out = "";
	const p = ssh(check);
	p.stdout.on("data", d => (out += d));
	p.on("close", () => {
		const why = { props: "server.properties 里还没有 broadcast-console-to-ops=false（不然管理员会在聊天里看到一串 [Server: ...]）", pack: "服务器上还没装数据包 xiaoke_fx", restart: "改了 server.properties 以后服务器还没重启", side: `现在开着的不是要连的服（${SIDE}）` }[out.trim()];
		fxEnabled = out.trim() === "ok";
		console.log(`${ts()} ${fxEnabled ? "气泡、声音、粒子开着" : `气泡、声音、粒子先关着：${why ?? `检查不了服务器（${out.trim() || "ssh 没有输出"}）`}`}`);
	});
}

function writeConsole(line) {
	if (!consoleWriter) {
		consoleWriter = spawn(SSH, [...SSH_OPTS, SERVER, `mc-active console ${SIDE}`], { stdio: ["pipe", "ignore", "ignore"], windowsHide: true });
		consoleWriter.on("close", () => { consoleWriter = null; });
		consoleWriter.stdin.on("error", () => { consoleWriter = null; });
	}
	consoleWriter.stdin.write(`${line}\n`);
}

function worldEffect(effect) {
	if (!fxEnabled) return false;
	const now = Date.now();
	while (fxTimes.length && now - fxTimes[0] > 60000) fxTimes.shift();
	// 一秒最多 6 个、一分钟最多 120 个，免得刷爆控制台
	if (fxTimes.length >= 120 || fxTimes.filter(t => now - t < 1000).length >= 6) return false;
	const line = renderEffect(effect, SELF);
	if (!line) return false;
	fxTimes.push(now);
	writeConsole(line);
	// 她自己嘀咕的话也是她的一部分：记进窗口日志，决策脑回顾时也能看到
	if (effect.kind === "bubble" && effect.style === "murmur") {
		const text = cleanText(effect.text);
		console.log(`${ts()} [嘀咕] ${text}`);
		remember(`${ts().slice(6)} 你头顶冒泡嘀咕: ${text}`);
	}
	return true;
}

// 快速反应层那边一直在跟人打交道，决策脑好一阵没被叫醒：叫它回顾一下，看看有没有要记下、要改打算的。
// 只有 [旁听] 不叫（10-09：她干长活时访客互相聊天，不该把决策脑叫醒）
every(() => {
	if (!clients[MIND].size || !reviewDue(digest, Date.now() - lastMindAt)) return;
	emit("回顾", "这段时间嘴巴那边一直在跟人打交道。看看有没有要记下来、要改打算的；对你说的话嘴巴那边已经回过了，你不用再回");
}, 30 * 1000);

// 世界里只剩小克一个人太久了：提醒她收拾收拾、自己下线
every(() => {
	if (aloneSince === null || aloneWarned || !clients[MIND].size || Date.now() - aloneSince < ALONE_MS) return;
	aloneWarned = true;
	emit("独处", `世界里只剩你一个人已经 ${Math.round((Date.now() - aloneSince) / 60000)} 分钟了。把手上的事收个尾，东西放好，写完日记，然后自己下线吧`);
}, 30 * 1000);

// 直接点 X 关掉小克的窗口时，启动器来不及关耳朵：看得到启动器的进程号就跟着它走；
// 看不到的话，太久没有小克来听（她的 Monitor 每 30 分钟重连一次），就自己退出
let lastListened = Date.now();
every(() => {
	if (PARENT_PID) {
		try { process.kill(PARENT_PID, 0); }
		catch { console.log(`${ts()} 启动器不在了，耳朵也关掉`); process.exit(0); }
	}
	if (listening()) lastListened = Date.now();
	else if (Date.now() - lastListened > 40 * 60 * 1000) {
		console.log(`${ts()} 40 分钟没有小克来听了，耳朵先关掉`);
		process.exit(0);
	}
}, 5 * 1000);
