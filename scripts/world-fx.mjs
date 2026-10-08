// 把身体想让别人看见、听见的效果（头顶的气泡、猫叫、粒子）变成服务器控制台命令。
// 命令只调用数据包 xiaoke_fx 里的几个函数（在服务器 world/datapacks/xiaoke_fx，源文件在本仓库 server/datapacks/xiaoke_fx），
// 声音和粒子只认下面列出来的名字；气泡里的字先过滤一遍再放进命令：去掉换行和控制字符（换行会让一条命令变成两条），
// 引号和反斜杠换成全角（不然能把字符串提前结束），游戏字体显示不了的 emoji 也去掉

// 名字 → [声音事件, 音量, 音高]。音高高一点，像小猫
export const SOUNDS = {
	"meow": ["entity.cat.ambient", 0.8, 1.35],
	"sad-meow": ["entity.cat.ambient", 0.7, 0.85],
	"squeak": ["entity.cat.ambient", 0.8, 1.8],
	"purr": ["entity.cat.purr", 1.0, 1.15],
	"purreow": ["entity.cat.purreow", 0.8, 1.3],
	"hiss": ["entity.cat.hiss", 0.8, 1.3],
	"beg": ["entity.cat.beg_for_food", 0.8, 1.3],
	"chime": ["block.note_block.chime", 0.6, 1.4],
};

// 名字 → [粒子, 离脚底多高, 横向散开, 竖向散开, 速度, 数量]
export const PARTICLES = {
	"heart": ["heart", 2.2, 0.4, 0.3, 0, 4],
	"happy": ["happy_villager", 1.9, 0.5, 0.5, 0, 10],
	"angry": ["angry_villager", 2.2, 0.3, 0.2, 0, 3],
	"note": ["note", 2.3, 0.5, 0.3, 1, 5],
	"cloud": ["cloud", 1.9, 0.15, 0.05, 0.01, 3],
	"tears": ["falling_water", 1.6, 0.2, 0.1, 0, 6],
	"sparkle": ["end_rod", 1.8, 0.3, 0.3, 0.02, 6],
};

// 气泡的样子：字的颜色、底色（ARGB，高位不超过 0x7f，免得超出 int）、大小
export const STYLES = {
	murmur: { color: "#fff4dc", bg: 0x60000000, scale: "1.0" },
	ponder: { color: "#d8d8d8", bg: 0x40000000, scale: "1.2" },
	mark: { color: "#ffd84a", bg: 0x00000000, scale: "1.8" },
};

export function cleanText(text, max = 60) {
	const BREAKS = [9, 10, 13, 0x2028, 0x2029];   // 换行、制表符：变成空格
	return [...String(text ?? "")]
		.map(c => (BREAKS.includes(c.codePointAt(0)) ? " " : c))
		.filter(c => {
			const code = c.codePointAt(0);
			// 控制字符、§（颜色代码）、BMP 以外的字（emoji 之类，游戏字体显示不了）
			return code >= 0x20 && !(code >= 0x7f && code <= 0x9f) && c !== "§" && code <= 0xffff;
		})
		.map(c => (c === '"' ? "＂" : c === "\\" ? "＼" : c))
		.join("")
		.replace(/ +/g, " ")
		.trim()
		.slice(0, max);
}

// 每个 bot 一个数字，用来认出哪个气泡是谁的（几个 AI 玩家可以同时冒泡）
export function bubbleId(login) {
	let h = 0;
	for (const c of login) h = (h * 31 + c.charCodeAt(0)) % 999983;
	return h + 1;
}

const LOGIN = /^[A-Za-z0-9_]{1,16}$/;

// 返回一条控制台命令；不认识的效果返回 null
export function renderEffect(effect, login, random = Math.random) {
	if (!LOGIN.test(login) || !effect || typeof effect !== "object") return null;
	const id = bubbleId(login);
	if (effect.kind === "bubble") {
		const style = STYLES[effect.style] ?? STYLES.murmur;
		const text = cleanText(effect.text);
		if (!text) return null;
		const seconds = Math.min(30, Math.max(1, Number(effect.seconds) || 4));
		return `function xiaoke_fx:bubble/show {name:"${login}",id:"${id}",ttl:"${Math.round(seconds * 20)}",text:"${text}",color:"${style.color}",bg:"${style.bg}",scale:"${style.scale}"}`;
	}
	if (effect.kind === "clear") return `function xiaoke_fx:bubble/clear {id:"${id}"}`;
	if (effect.kind === "sound") {
		const s = SOUNDS[effect.name];
		if (!s) return null;
		const pitch = (s[2] + (random() - 0.5) * 0.1).toFixed(2);   // 每次音高差一点点，听起来不像录音
		return `function xiaoke_fx:sound {name:"${login}",sound:"${s[0]}",volume:"${s[1]}",pitch:"${pitch}"}`;
	}
	if (effect.kind === "particle") {
		const p = PARTICLES[effect.name];
		if (!p) return null;
		return `function xiaoke_fx:particle {name:"${login}",particle:"${p[0]}",dy:"${p[1]}",dx:"${p[2]}",dyy:"${p[3]}",speed:"${p[4]}",count:"${p[5]}"}`;
	}
	return null;
}
