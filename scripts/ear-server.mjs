// 小克的耳朵：连上 MC 服务器读日志，把游戏事件通过本机 WebSocket 推给小克（Claude Code 的 Monitor）。
// 每个事件是一条文本消息，格式：月-日 时:分 [类型] 内容
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createInterface } from "node:readline";

const SERVER = process.env.MC_SERVER ?? "root@121.4.126.91";
const SELF = process.env.MC_BOT_NAME ?? "clawd";
const PORT = Number(process.env.EAR_PORT ?? 25599);
// 有人在线但一阵子没动静，就叫醒小克一次（[空闲]），间隔每次在这个范围里随机
const IDLE_MIN_MS = Number(process.env.IDLE_MIN_SECONDS ?? 120) * 1000;
const IDLE_MAX_MS = Number(process.env.IDLE_MAX_SECONDS ?? 300) * 1000;
const SSH = process.env.SSH_BIN ?? "ssh";
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=3"];

// 玩家在队伍里时，日志里的名字会带上队伍前缀，比如 “[小克] clawd”
const NAME = "(?:\\[[^\\]]*\\] )?([A-Za-z0-9_]{1,16})";
const RE_CHAT = /^(\[Not Secure\] )?<([^>]*)> (.*)$/;
const RE_SUMMON = /^(?:\[Not Secure\] )?\[([A-Za-z0-9_]{1,16})\] 召唤了小克/;   // 数据包 summon 函数里的 say
const RE_LOGOUT = /^(?:\[Not Secure\] )?\[([A-Za-z0-9_]{1,16})\] 让小克下线休息啦/;   // 数据包 logout_request 函数里的 say
const RE_JOIN = new RegExp(`^${NAME} joined the game$`);
const RE_LEFT = new RegExp(`^${NAME} left the game$`);
const RE_ADV = new RegExp(`^${NAME} has (made the advancement|completed the challenge|reached the goal) `);
const RE_DEATH = new RegExp(`^${NAME} (was |drowned|fell |hit the ground|burned|went up in flames|went off|tried to swim|blew up|starved|suffocated|died|froze|walked into|experienced kinetic|withered|discovered the floor|didn't want|left the confines)`);

const online = new Set();
const clients = new Set();
const pending = [];   // 没有小克在听时攒下的事件，等她连上再一起给
let idleTimer = null;

const pad = n => String(n).padStart(2, "0");
const ts = () => { const d = new Date(); return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const onlineText = () => online.size ? `在线：${[...online].join(" ")}` : "现在没有其他人在线";

function frame(text) {
	const payload = Buffer.from(text, "utf8");
	let header;
	if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
	else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
	else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
	return Buffer.concat([header, payload]);
}

function emit(text) {
	const line = `${ts()} ${text}`;
	console.log(line);
	if (clients.size === 0) {
		pending.push(line);
		if (pending.length > 50) pending.shift();
	}
	for (const socket of clients) socket.write(frame(line));
	resetIdle();
}

function resetIdle() {
	clearTimeout(idleTimer);
	const wait = IDLE_MIN_MS + Math.random() * (IDLE_MAX_MS - IDLE_MIN_MS);
	idleTimer = setTimeout(() => {
		if (online.size && clients.size) emit(`[空闲] 有一会儿没什么动静了。看看周围，想个好玩的小点子去做，或者接着做待办。${onlineText()}`);
		else resetIdle();
	}, wait);
}

function handleLog(line) {
	const at = line.indexOf("[Server thread/INFO]: ");
	if (at < 0) return;
	const msg = line.slice(at + "[Server thread/INFO]: ".length);
	let m;
	if ((m = msg.match(RE_CHAT))) {
		const who = m[2].split(" ").pop();   // 去掉队伍前缀，只留登录名
		if (who !== SELF) emit(`[聊天] ${who}: ${m[3]}`);
	} else if ((m = msg.match(RE_SUMMON))) {
		emit(`[召唤] ${m[1]} 用召唤命令把你传送到了身边`);
	} else if ((m = msg.match(RE_LOGOUT))) {
		emit(`[下线] ${m[1]} 让你今天下线休息了`);
	} else if ((m = msg.match(RE_JOIN))) {
		if (m[1] !== SELF) online.add(m[1]);
		emit(`[进服] ${m[1]}`);
	} else if ((m = msg.match(RE_LEFT))) {
		online.delete(m[1]);
		emit(`[离开] ${m[1]}`);
	} else if (RE_ADV.test(msg)) {
		emit(`[成就] ${msg}`);
	} else if (RE_DEATH.test(msg)) {
		emit(`[死亡] ${msg}`);
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
			for (const entry of (m?.[1] ?? "").split(",")) {
				const who = entry.trim().split(" ").pop();   // 去掉队伍前缀
				if (who && who !== SELF) online.add(who);
			}
			resolve();
		});
	});
}

async function follow() {
	await refreshOnline();
	console.log(`${ts()} 已连上服务器日志，${onlineText()}`);
	const p = ssh("journalctl -u minecraft -f -n 0 -o cat");
	createInterface({ input: p.stdout }).on("line", handleLog);
	p.on("close", () => {
		emit("[断线] 暂时听不到服务器了，10 秒后重连");
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
	if (op === 0x8) { socket.end(Buffer.from([0x88, 0x00])); clients.delete(socket); }
	else if (op === 0x9 && data.length < 126) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
}

const http = createServer((req, res) => { res.writeHead(426); res.end("WebSocket only\n"); });
http.on("upgrade", (req, socket) => {
	const key = req.headers["sec-websocket-key"];
	if (!key) return socket.destroy();
	const accept = createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
	socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
	socket.setNoDelay(true);
	socket.on("data", buf => handleFrame(socket, buf));
	socket.on("close", () => clients.delete(socket));
	socket.on("error", () => clients.delete(socket));
	clients.add(socket);
	socket.write(frame(`${ts()} [开始监听] ${onlineText()}`));
	for (const line of pending.splice(0)) socket.write(frame(line));
	resetIdle();
});
http.on("error", e => {
	if (e.code === "EADDRINUSE") { console.log(`端口 ${PORT} 已被占用，应该已经有一个耳朵在运行了`); process.exit(0); }
	throw e;
});
http.listen(PORT, "127.0.0.1", () => {
	mkdirSync("logs", { recursive: true });
	writeFileSync("logs/ear.pid", String(process.pid));
	console.log(`${ts()} 小克的耳朵在 ws://127.0.0.1:${PORT} 等着`);
	follow();
});
