// 小克的耳朵：连上 MC 服务器读日志，把游戏事件通过本机 WebSocket 推给小克（Claude Code 的 Monitor）。
// 每个事件是一条文本消息，格式：月-日 时:分 [类型] 内容
// 小克的脑子分成一快一慢两层（见 scripts/start.mjs），各连一个地址，耳朵按事件类型分给它们：
// - ws://127.0.0.1:25599/fast  快速反应层：聊天、进出、礼物、注视……来了马上接话。后面附上〔现在〕（问身体要的一行状况）
// - ws://127.0.0.1:25599/mind  思维层：长活结束、提醒、空闲、天气、[记下]、下线……慢慢想。后面附上这段时间快速反应层那边发生的事
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

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
// 有人在线但一阵子没动静，就叫醒思维层一次（[空闲]），间隔每次在这个范围里随机
const IDLE_MIN_MS = Number(process.env.IDLE_MIN_SECONDS ?? 120) * 1000;
const IDLE_MAX_MS = Number(process.env.IDLE_MAX_SECONDS ?? 300) * 1000;
// 快速反应层那边一直热闹、思维层这么久没被叫醒过，就叫它回顾一下（[回顾]）
const REVIEW_MS = Number(process.env.REVIEW_MINUTES ?? 4) * 60 * 1000;
// 世界里只剩小克一个人这么久，就提醒她收拾收拾下线（[独处]）
const ALONE_MS = Number(process.env.ALONE_LOGOUT_MINUTES ?? 30) * 60 * 1000;
// 启动器的进程号：它没了（窗口被直接关掉），耳朵也退出
const PARENT_PID = Number(process.env.EAR_PARENT_PID) || 0;
const SSH = process.env.SSH_BIN ?? "ssh";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];

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

// 哪类事件叫醒哪一层。快速反应层管嘴巴和小动作，思维层管打算、长活和记忆
const FAST = "fast", MIND = "mind";
const ROUTES = {
	聊天: [FAST], 进服: [FAST], 离开: [FAST], 成就: [FAST], 死亡: [FAST], 礼物: [FAST], 注视: [FAST], 召唤: [FAST],
	危险: [FAST, MIND], 断线: [FAST, MIND],
	进展: [MIND], 提醒: [MIND], 空闲: [MIND], 天气: [MIND], 记下: [MIND], 下线: [MIND], 独处: [MIND], 回顾: [MIND],
};

const online = new Set();      // 在线的真人访客
const companionsOnline = new Set();
const clients = { [FAST]: new Set(), [MIND]: new Set() };
const pending = { [FAST]: [], [MIND]: [] };   // 那一层没在听时攒下的事件，等它连上再一起给
// 只叫醒了快速反应层的事（还有小克自己在聊天里说的话），攒着，下次叫醒思维层时一起给它看
const digest = [];
let lastMindAt = Date.now();
let fastQueue = Promise.resolve();   // 给快速反应层的事件要先问身体要〔现在〕，排好队免得顺序乱
let idleTimer = null;
let journal = null;   // 读服务器日志的 ssh 进程，耳朵退出时一起关掉
let busyUntil = 0;    // 小克在做后台长活（砍树、钓鱼、探险……）时不发 [空闲]，做完会有 [进展] 叫醒她
let aloneSince = Date.now();   // 从什么时候起没有别人在线（有人在线时是 null）
let aloneWarned = false;

const pad = n => String(n).padStart(2, "0");
const ts = () => { const d = new Date(); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const onlineText = () => (online.size ? `在线：${[...online].join(" ")}` : "现在没有其他人在线")
	+ (companionsOnline.size ? `（AI 同伴在线：${[...companionsOnline].join(" ")}）` : "");
const listening = () => clients[FAST].size + clients[MIND].size;

function frame(text) {
	const payload = Buffer.from(text, "utf8");
	let header;
	if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
	else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
	else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
	return Buffer.concat([header, payload]);
}

function deliver(layer, text) {
	if (layer === MIND) lastMindAt = Date.now();
	if (clients[layer].size === 0) {
		pending[layer].push(text);
		if (pending[layer].length > 50) pending[layer].shift();
	}
	for (const socket of clients[layer]) socket.write(frame(text));
}

function remember(entry) {
	digest.push(entry.length > 200 ? `${entry.slice(0, 200)}…` : entry);
	while (digest.length > 40 || digest.join(" ／ ").length > 3000) digest.shift();
}

function takeDigest() {
	if (!digest.length) return "";
	return `　（这段时间嘴巴那边：${digest.splice(0).join(" ／ ")}）`;
}

async function withSnapshot(line) {
	try {
		const res = await fetch(`${BODY_URL}/snapshot?for=fast`, { signal: AbortSignal.timeout(800) });
		if (res.ok) return `${line}　${await res.text()}`;
	} catch {
		// 身体还没起来或者卡住了，就只发事件本身
	}
	return line;
}

function emit(kind, body, to = ROUTES[kind]) {
	const line = `${ts()} [${kind}] ${body}`;
	console.log(`${line}  → ${to.join("+")}`);
	if (to.includes(MIND)) deliver(MIND, line + takeDigest());
	else remember(line.slice(6));   // 去掉日期，只留时:分
	if (to.includes(FAST)) fastQueue = fastQueue.then(() => withSnapshot(line)).then(text => deliver(FAST, text));
	resetIdle();
}

function resetIdle() {
	clearTimeout(idleTimer);
	const wait = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
	idleTimer = setTimeout(() => {
		if (online.size && clients[MIND].size && Date.now() > busyUntil) emit("空闲", `有一会儿没什么动静了。接着过你自己的日子：推进手上的打算，或者看看周围冒个小点子。${onlineText()}`);
		else resetIdle();
	}, wait);
}

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
		else if (who !== SELF) emit("聊天", `${who}: ${m[3]}`);
		else remember(`${ts().slice(6)} 你: ${m[3]}`);   // 自己说的话（两层都可能说），思维层回顾时要看到前后文
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
		// 自己死了两层都要知道：快的那一面喊一声，慢的那一面重新打算（东西掉了、人在访客小屋）
		emit("死亡", msg, m[1] === SELF ? [FAST, MIND] : ROUTES.死亡);
	}
}

function ssh(command) {
	return spawn(SSH, [...SSH_OPTS, SERVER, command], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
}

function refreshOnline() {
	return new Promise(resolve => {
		let out = "";
		const p = ssh("mc list");
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

async function follow() {
	await refreshOnline();
	console.log(`${ts()} 已连上服务器日志，${onlineText()}`);
	const p = journal = ssh("journalctl -u minecraft -f -n 0 -o cat");
	createInterface({ input: p.stdout }).on("line", handleLog);
	p.on("close", () => {
		emit("断线", "暂时听不到服务器了，10 秒后重连");
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
	if (op === 0x8) { socket.end(Buffer.from([0x88, 0x00])); clients[FAST].delete(socket); clients[MIND].delete(socket); }
	else if (op === 0x9 && data.length < 126) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
}

// 小克的 MCP（身体）发来的消息：后台长活结束了（进展）、她给自己定的提醒到了（提醒）、有人扔东西给她（礼物）、下雨雨停（天气）、
// 有人一直盯着她（注视）、怪物太近本能跑开（危险）、快速反应层记下来交给思维层的事（记下）、开始 / 结束忙
function handleMcp(path, body) {
	const data = JSON.parse(body || "{}");
	if (path === "/event" && ["进展", "提醒", "礼物", "天气", "注视", "危险", "记下"].includes(data.kind) && typeof data.text === "string") {
		if (data.kind === "进展") busyUntil = 0;
		emit(data.kind, data.text.slice(0, 1000));
	} else if (path === "/busy") {
		busyUntil = data.busy ? Date.now() + 20 * 60 * 1000 : 0;   // 最多算 20 分钟“在忙”，免得任务卡死后再也不叫她
		if (!data.busy) resetIdle();
	} else throw new Error("unknown message");
}

const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const http = createServer((req, res) => {
	// 新的启动器启动前会来请旧的耳朵退出
	if (req.url === "/shutdown") { res.end("bye\n"); setTimeout(() => process.exit(0), 100); return; }
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
	const layer = (req.url ?? "/").startsWith("/mind") ? MIND : FAST;
	const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
	socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
	socket.setNoDelay(true);
	socket.on("data", buf => handleFrame(socket, buf));
	socket.on("close", () => clients[layer].delete(socket));
	socket.on("error", () => clients[layer].delete(socket));
	clients[layer].add(socket);
	console.log(`${ts()} ${layer === MIND ? "思维层" : "快速反应层"}开始听了`);
	socket.write(frame(`${ts()} [开始监听] ${onlineText()}`));
	for (const line of pending[layer].splice(0)) socket.write(frame(line));
	resetIdle();
});
http.on("error", e => {
	if (e.code === "EADDRINUSE") { console.log(`端口 ${PORT} 已被占用，应该已经有一个耳朵在运行了`); process.exit(0); }
	throw e;
});
http.listen(PORT, "127.0.0.1", () => {
	mkdirSync("logs", { recursive: true });
	writeFileSync("logs/ear.pid", String(process.pid));
	console.log(`${ts()} ${NICK}（${SELF}）的耳朵在 ws://127.0.0.1:${PORT}/fast 和 /mind 等着${COMPANIONS.size ? `，AI 同伴：${[...COMPANIONS].join(" ")}` : ""}`);
	follow();
});
process.on("exit", () => journal?.kill());

// 快速反应层那边一直在跟人打交道，思维层好一阵没被叫醒：叫它回顾一下，看看有没有要记下、要改打算的
setInterval(() => {
	if (!digest.length || !clients[MIND].size || Date.now() - lastMindAt < REVIEW_MS) return;
	emit("回顾", "这段时间嘴巴那边一直在跟人打交道。看看有没有要记下来、要改打算的；别人的话嘴巴那边已经回过了，你不用再回");
}, 30 * 1000);

// 世界里只剩小克一个人太久了：提醒她收拾收拾、自己下线
setInterval(() => {
	if (aloneSince === null || aloneWarned || !clients[MIND].size || Date.now() - aloneSince < ALONE_MS) return;
	aloneWarned = true;
	emit("独处", `世界里只剩你一个人已经 ${Math.round((Date.now() - aloneSince) / 60000)} 分钟了。把手上的事收个尾，东西放好，写完日记，然后自己下线吧`);
}, 30 * 1000);

// 直接点 X 关掉小克的窗口时，启动器来不及关耳朵：看得到启动器的进程号就跟着它走；
// 看不到的话，太久没有小克来听（她的 Monitor 每 30 分钟重连一次），就自己退出
let lastListened = Date.now();
setInterval(() => {
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
