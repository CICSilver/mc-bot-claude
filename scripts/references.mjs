// 盖房子的参考（prompts/小克/参考/，归你）：每个参考一个文件夹，放建筑文件（.litematic，或者原版结构 .nbt）、截图，再加一张灵感卡 灵感.md。
// 这个脚本给有建筑文件的参考补上两张预览图（东南.png、西北.png，方块按名字粗略上色）和一份 材料.md（用了哪些方块、各多少），
// 建筑文件比预览新的时候重画。思维层只看预览图、灵感卡和材料，不拿整栋的图纸，免得照着原样盖。
// 用法：node scripts/references.mjs        启动器每次启动也会调用一次
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { REFERENCE_DIR } from "./prompt.mjs";
import { gunzipSync, deflateSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// NBT 解析借身体（MCP）那边装好的 prismarine-nbt
function loadNbt() {
	const body = JSON.parse(readFileSync(join(ROOT, "config", "xiaoke-body.json"), "utf8"));
	return createRequire(join(resolve(ROOT, body.mcp), "package.json"))("prismarine-nbt");
}

// 读成 { sx, sy, sz, at(x, y, z) -> 方块名 }
async function loadBuild(nbt, path) {
	let buf = readFileSync(path);
	try { buf = gunzipSync(buf); } catch { /* 没压缩 */ }
	const root = nbt.simplify((await nbt.parse(buf)).parsed);
	if (root.Regions) {   // Litematica：方块状态压在 long 数组里
		const region = Object.values(root.Regions)[0];
		const sx = Math.abs(region.Size.x), sy = Math.abs(region.Size.y), sz = Math.abs(region.Size.z);
		const palette = region.BlockStatePalette.map(p => p.Name.replace("minecraft:", ""));
		const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
		const longs = region.BlockStates.map(([hi, lo]) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0));
		const mask = (1n << BigInt(bits)) - 1n;
		const state = i => {
			const bit = BigInt(i * bits), idx = Number(bit >> 6n), off = bit & 63n;
			let v = longs[idx] >> off;
			if (off + BigInt(bits) > 64n) v |= longs[idx + 1] << (64n - off);
			return Number(v & mask);
		};
		return { sx, sy, sz, at: (x, y, z) => palette[state((y * sz + z) * sx + x)] };
	}
	// 原版结构文件：size + palette + blocks[{pos, state}]
	const [sx, sy, sz] = root.size;
	const palette = (root.palette ?? root.palettes[0]).map(p => p.Name.replace("minecraft:", ""));
	const grid = new Map(root.blocks.map(b => [b.pos.join(","), palette[b.state]]));
	return { sx, sy, sz, at: (x, y, z) => grid.get(`${x},${y},${z}`) ?? "air" };
}

const EMPTY = /^(air|cave_air|void_air|structure_void|jigsaw|barrier|light)$/;
const DYE = { white: [233, 236, 236], orange: [240, 118, 19], magenta: [189, 68, 179], light_blue: [58, 175, 217], yellow: [248, 198, 39], lime: [112, 185, 25], pink: [237, 141, 172], gray: [62, 68, 71], light_gray: [142, 142, 134], cyan: [21, 137, 145], purple: [121, 42, 172], blue: [53, 57, 157], brown: [114, 71, 40], green: [84, 109, 27], red: [161, 39, 34], black: [20, 21, 25] };
const TERRACOTTA = { white: [209, 178, 161], orange: [161, 83, 37], magenta: [149, 88, 108], light_blue: [113, 108, 137], yellow: [186, 133, 35], lime: [103, 117, 52], pink: [161, 78, 78], gray: [57, 42, 35], light_gray: [135, 106, 97], cyan: [86, 91, 91], purple: [118, 70, 86], blue: [74, 59, 91], brown: [77, 51, 35], green: [76, 83, 42], red: [143, 61, 46], black: [37, 22, 16] };
const WOOD = { oak: [162, 130, 78], spruce: [114, 84, 48], birch: [196, 179, 123], jungle: [160, 115, 80], acacia: [168, 90, 50], dark_oak: [66, 43, 20], mangrove: [117, 54, 48], cherry: [226, 178, 172], bamboo: [194, 173, 80], crimson: [101, 48, 70], warped: [43, 104, 99], pale_oak: [227, 217, 214] };
const RULES = [
	[/glass_pane|^glass$|tinted_glass/, [190, 220, 230, 120]],
	[/water/, [60, 100, 220, 150]],
	[/lava/, [230, 100, 20]],
	[/cherry_leaves|flowering_azalea|pink_petals/, [235, 160, 190]],
	[/leaves|azalea|moss|grass_block|^grass$|short_grass|tall_grass|fern|vine|lily_pad|kelp|seagrass|sweet_berry|sapling/, [80, 140, 60]],
	[/bamboo|scaffolding/, [130, 170, 60]],
	[/calcite|quartz|white_concrete|snow|bone_block|end_rod/, [232, 232, 226]],
	[/diorite/, [205, 205, 205]],
	[/andesite/, [136, 136, 138]],
	[/deepslate|blackstone|basalt/, [70, 70, 75]],
	[/stone_brick|^stone|cobblestone|smooth_stone|gravel|tuff|furnace|smoker|brewing_stand/, [125, 125, 125]],
	[/sandstone|^sand$/, [216, 203, 155]],
	[/mud_brick|packed_mud/, [140, 106, 80]],
	[/^dirt|coarse_dirt|rooted_dirt|podzol|farmland|dirt_path/, [134, 96, 67]],
	[/brick|flower_pot|potted/, [150, 74, 58]],
	[/lantern|torch|candle|campfire|glowstone|shroomlight|froglight|sea_pickle/, [255, 190, 90]],
	[/beehive|bee_nest|hay|loom|turtle_egg/, [200, 160, 70]],
	[/barrel|chest|bookshelf|lectern|composter|tripwire_hook|lever/, [140, 100, 55]],
	[/redstone_block/, [170, 20, 10]],
	[/iron|chain|anvil|cauldron|pressure_plate/, [160, 160, 165]],
	[/coral/, [150, 140, 130]],
	[/copper/, [190, 110, 80]],
	[/prismarine/, [90, 160, 150]],
	[/flower|tulip|poppy|dandelion|orchid|allium|bluet|daisy|cornflower|lily_of|rose|peony|lilac|sunflower/, [220, 80, 120]],
];
function color(name) {
	if (!name || EMPTY.test(name)) return null;
	for (const dye of Object.keys(DYE)) {
		if (name === `${dye}_terracotta` || name === `${dye}_glazed_terracotta`) return TERRACOTTA[dye];
		if (name.startsWith(`${dye}_`) && /concrete|wool|carpet|stained_glass|banner|bed|candle|shulker/.test(name)) return /stained_glass/.test(name) ? [...DYE[dye], 150] : DYE[dye];
	}
	if (name === "terracotta") return [152, 94, 67];
	for (const [rx, c] of RULES) if (rx.test(name)) return c;
	for (const [wood, c] of Object.entries(WOOD)) if (name.startsWith(`${wood}_`) || name.startsWith(`stripped_${wood}_`)) {
		if (name.startsWith("stripped_")) return c.map(v => Math.min(255, v + 25));
		return /_log$|_wood$|_stem$|_hyphae$/.test(name) ? c.map(v => Math.round(v * 0.8)) : c;
	}
	return [255, 0, 255];   // 不认识的：品红，一眼看得出
}

// 等距视角：view 那个角朝着看的人
function render(w, view, T = 12) {
	const rot = { se: (x, z) => [x, z], nw: (x, z) => [w.sx - 1 - x, w.sz - 1 - z] }[view];
	const RX = w.sx, RZ = w.sz;
	const W = (RX + RZ + 1) * T + 4, H = Math.ceil((RX + RZ) * T / 2) + (w.sy + 1) * T + 4;
	const img = Buffer.alloc(W * H * 4);
	for (let i = 0; i < W * H; i++) img.set([245, 242, 235, 255], i * 4);
	const px = (x, y, c, a) => {
		x = Math.floor(x); y = Math.floor(y);
		if (x < 0 || y < 0 || x >= W || y >= H) return;
		const i = (y * W + x) * 4, k = a / 255;
		for (let j = 0; j < 3; j++) img[i + j] = Math.round(img[i + j] * (1 - k) + c[j] * k);
	};
	const cells = [];
	for (let y = 0; y < w.sy; y++) for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
		const c = color(w.at(x, y, z));
		if (c) { const [a, b] = rot(x, z); cells.push([a, y, b, c]); }
	}
	cells.sort((p, q) => (p[0] + p[2]) - (q[0] + q[2]) || p[1] - q[1]);   // 从远到近
	for (const [a, y, b, c] of cells) {
		const ox = (a - b + RZ) * T + 2, oy = (a + b) * T / 2 + (w.sy - 1 - y) * T + 2;
		const alpha = c[3] ?? 255;
		const shade = f => c.slice(0, 3).map(v => Math.round(v * f));
		for (let dy = 0; dy < T; dy++) for (let dx = -T; dx < T; dx++) {
			if (Math.abs(dx + 0.5) / T + Math.abs(dy - T / 2 + 0.5) / (T / 2) <= 1) px(ox + T + dx, oy + dy, shade(1), alpha);
		}
		for (let dx = 0; dx < T; dx++) for (let dy = 0; dy < T; dy++) {
			px(ox + dx, oy + T / 2 + dx / 2 + dy, shade(0.78), alpha);
			px(ox + 2 * T - 1 - dx, oy + T / 2 + dx / 2 + dy, shade(0.62), alpha);
		}
	}
	return png(W, H, img);
}

function png(W, H, rgba) {
	const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
	const crc = b => { let c = 0xffffffff; for (const v of b) c = table[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
	const chunk = (type, data) => {
		const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
		return Buffer.concat([len, body, sum]);
	};
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr.set([8, 6, 0, 0, 0], 8);
	const raw = Buffer.alloc((W * 4 + 1) * H);
	for (let y = 0; y < H; y++) rgba.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4);
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

// 用了哪些方块、各多少（朝向不分开算），按多少排
function materials(w, source) {
	const counts = new Map();
	for (let y = 0; y < w.sy; y++) for (let z = 0; z < w.sz; z++) for (let x = 0; x < w.sx; x++) {
		const n = w.at(x, y, z);
		if (!EMPTY.test(n)) counts.set(n, (counts.get(n) ?? 0) + 1);
	}
	const total = [...counts.values()].reduce((a, b) => a + b, 0);
	const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([n, c]) => `| ${n} | ${c} |`);
	return `# 用了哪些方块\n\n由 scripts/references.mjs 从 ${source} 自动统计。大小 ${w.sx}×${w.sy}×${w.sz}（东西×高×南北），一共 ${total} 块，${counts.size} 种。\n\n| 方块 | 数量 |\n|---|---|\n${rows.join("\n")}\n`;
}

// 补上缺的、过时的预览图和材料表；返回做了什么
export async function refreshReferences(log = console.log) {
	const dir = join(ROOT, REFERENCE_DIR);
	if (!existsSync(dir)) return;
	let nbt = null;
	for (const name of readdirSync(dir)) {
		const folder = join(dir, name);
		if (!statSync(folder).isDirectory()) continue;
		const build = readdirSync(folder).find(f => /\.(litematic|nbt)$/i.test(f));
		if (!build) continue;
		const source = join(folder, build);
		const outputs = ["东南.png", "西北.png", "材料.md"].map(f => join(folder, f));
		if (outputs.every(f => existsSync(f) && statSync(f).mtimeMs >= statSync(source).mtimeMs)) continue;
		try {
			nbt ??= loadNbt();
			const w = await loadBuild(nbt, source);
			writeFileSync(outputs[0], render(w, "se"));
			writeFileSync(outputs[1], render(w, "nw"));
			writeFileSync(outputs[2], materials(w, build));
			log(`参考《${name}》：画好了预览图，统计了材料`);
		} catch (e) {
			log(`参考《${name}》：读不了 ${build}（${e.message}）`);
		}
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await refreshReferences();
