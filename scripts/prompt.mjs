// 把小克的设定拼成每一层的系统提示词，顺便检查几处容易对不上的地方：
//   prompts/小克/人格.md、生活.md —— 她是谁、怎么过日子（主人自己维护）。快速反应层和决策脑看；执行脑只管把活做成，不带这两份，免得每走一步都重读
//   prompts/系统/共用.md —— 世界、身体、三层分工、说话限制、好感度、安全（三层都看）
//   prompts/世界/<world>.md —— 她在哪个世界：出生点在哪、有什么。正式版和测试版各连一个服，用 config/xiaoke-body.json 的 world 选（三层都看）
//   prompts/系统/快.md、执行.md、决策.md —— 这一层自己的规则；测试版.md —— 测试号另加的说明
//   prompts/系统/手册/ —— 用到时再读的手册，目录给执行脑和决策脑（快速反应层用不上）
//   prompts/小克/参考/ —— 盖房子的参考（灵感卡、预览图，主人放进来的），目录只给决策脑
// 启动器（scripts/start.mjs）每次启动都会调用；也可以单独运行看看拼出来的样子和检查结果：
//   node scripts/prompt.mjs        → 写到 logs/prompt-{fast,exec,mind}.preview.md，并列出检查结果
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MANUAL_DIR = "prompts/系统/手册";
export const WORLD_DIR = "prompts/世界";
const LAYER_FILES = { fast: "prompts/系统/快.md", exec: "prompts/系统/执行.md", mind: "prompts/系统/决策.md" };
export const LAYER_NAMES = Object.keys(LAYER_FILES);
// 哪一层带她自己的两份（人格、生活），哪一层有手册目录、参考的概要（一共几份、有哪些标签）
const WITH_PERSONA = new Set(["fast", "mind"]);
const WITH_MANUALS = new Set(["exec", "mind"]);
const WITH_REFERENCES = new Set(["mind"]);
const read = path => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
// <!-- --> 里是写给维护的人看的说明，不给小克
const stripComments = text => text.replace(/<!--[\s\S]*?-->\n?/g, "").trim();

export function buildStartupMemory(home) {
	return [
		"## 醒来时已读到的记忆",
		"下面是启动程序从你的记忆里读取的当前内容，无需再重复读取。跟人打招呼、接话前先按人物记忆确认已有称呼和约定；已有昵称就继续用。历史经历里的旧好感度不是当前分数，需要确认分数时用 get-relationships。",
		...['self.md', 'people.md'].map(name => `### memory/${name}\n${readFileSync(join(home, 'memory', name), 'utf8')}`),
	].join("\n\n");
}

function loadManuals() {
	return readdirSync(join(ROOT, MANUAL_DIR)).filter(f => f.endsWith(".md")).sort().map(file => {
		const text = read(`${MANUAL_DIR}/${file}`);
		return {
			path: `${MANUAL_DIR}/${file}`,
			title: file.replace(/\.md$/, ""),
			when: text.match(/^>\s*什么时候读[：:]\s*(.+)$/m)?.[1].trim(),
			text,
		};
	});
}

// 盖房子的参考：每个文件夹一份，灵感.md 开头写着“> 适合什么时候看：……”，旁边可能有预览图和材料表
export const REFERENCE_DIR = "prompts/小克/参考";
function loadReferences() {
	const dir = join(ROOT, REFERENCE_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort().map(name => {
		const files = readdirSync(join(dir, name));
		const card = files.includes("灵感.md") ? read(`${REFERENCE_DIR}/${name}/灵感.md`) : "";
		return {
			name,
			hasCard: Boolean(card),
			when: card.match(/^>\s*适合什么时候看[：:]\s*(.+)$/m)?.[1].trim(),
			// 大点子（院子、景观、配色、形状这种）写在目录里，设计时不用一份份打开也能挑（第 3 步：让大点子更容易被用上）
			big: card.match(/^>\s*大点子[：:]\s*(.+)$/m)?.[1].trim(),
			tags: card.match(/^>\s*标签[：:]\s*(.+)$/m)?.[1].trim(),
			pictures: files.filter(f => /\.(png|jpe?g|webp)$/i.test(f)),
		};
	});
}

// MCP 里注册了哪些工具（从 config/xiaoke-body.json 指向的 MCP 目录里读），读不到就返回 null
function mcpToolNames() {
	try {
		const body = JSON.parse(read("config/xiaoke-body.json"));
		const mcpRoot = resolve(ROOT, body.mcp);
		const dir = [join(mcpRoot, "src", "tools"), join(mcpRoot, "dist", "tools")].find(existsSync);
		if (!dir) return null;
		const names = new Set();
		for (const file of readdirSync(dir).filter(f => /\.(ts|js)$/.test(f) && !f.endsWith(".d.ts"))) {
			for (const m of readFileSync(join(dir, file), "utf8").matchAll(/registerTool\(\s*["']([a-z0-9-]+)["']/g)) names.add(m[1]);
		}
		// 表情名（shake-head 这种带连字符的）也算认识的词
		const expressions = [join(mcpRoot, "src", "expressions.ts"), join(mcpRoot, "dist", "expressions.js")].find(existsSync);
		if (expressions) for (const m of readFileSync(expressions, "utf8").matchAll(/^\s*'([a-z]+(?:-[a-z]+)+)':\s*\{/gm)) names.add(m[1]);
		return names;
	} catch {
		return null;
	}
}

// 这个小克在哪个世界：config/xiaoke-body.json 的 world（正式版“正式世界”，测试版“测试世界”）
function configuredWorld() {
	try { return JSON.parse(read("config/xiaoke-body.json")).world; } catch { return undefined; }
}

// layer: "fast"、"exec" 或 "mind"；testBot: 测试号（服务器 /trigger 不认它），另加测试版说明；world: prompts/世界/ 里哪一份，不给就看 config；
// manualPath / referencePath: 从小克的工作目录（记忆所在的 home）看，手册和参考在哪。home 不是本目录时，启动器会把它们拷一份过去
export function buildLayerPrompt(layer, { testBot = false, world = configuredWorld(), manualPath = MANUAL_DIR, referencePath = REFERENCE_DIR } = {}) {
	const persona = stripComments(read("prompts/小克/人格.md"));
	const life = stripComments(read("prompts/小克/生活.md"));
	const shared = stripComments(read("prompts/系统/共用.md"));
	const worldFile = world ? `${WORLD_DIR}/${world}.md` : null;
	const worldText = worldFile && existsSync(join(ROOT, worldFile)) ? stripComments(read(worldFile)) : "";
	const test = testBot ? stripComments(read("prompts/系统/测试版.md")) : "";
	const own = stripComments(read(LAYER_FILES[layer]));
	const manuals = loadManuals();
	const index = manuals.map(m => `- 《${m.title}》（${manualPath}/${m.title}.md）：${m.when ?? "随时可以翻翻"}`).join("\n");
	const references = loadReferences();
	// 参考不再整个列在设定里：多了以后每次叫醒都要读一遍，跟眼前这块地多半没关系（10-09 用户：怕污染上下文）。
	// 设定里只说有多少份、大概有哪几类，设计时用 find-inspiration 按地形和想要的东西找两三份，再 Read 那几份
	const usable = references.filter(r => r.hasCard && r.tags);
	// 标签全列出来（去重）：以前截到前 30 个，山坡、陡坡、半地下、阁楼、雪地、秘密基地、阳台这几个排在后面就看不到了（10-09）
	const kinds = [...new Set(usable.flatMap(r => r.tags.split(/[\s,，、]+/)).filter(Boolean))].join(" ");
	const referenceIndex = usable.length ? `盖房子的参考一共 ${usable.length} 份，在 ${referencePath}/ 下面，每份一个文件夹（灵感.md、东南.png、西北.png）。标签有：${kinds}。` : "";
	const intro = WITH_PERSONA.has(layer)
		? "以下是小克的设定。第一部分是你自己：你是谁、什么性子、怎么说话、怎么过日子。第二部分是这个世界、你的身体和三层分工的规则，最后是你这一层（反应快的那一面，或者拿主意的那一面）自己的规则。\n" +
		  "两部分说法对不上时：安全、传送、下线、工具、机制和三层分工上的限制，以第二部分为准；在这些限制之内想做什么、怎么做、做成什么样子，按第一部分你自己的性子来。"
		: "以下是小克的设定：这个世界、你的身体和三层分工的规则，最后是你这一层（动手的那一面）自己的规则。";
	const text = [
		intro,
		"---",
		...(WITH_PERSONA.has(layer) ? [persona, life, "---"] : []),
		shared,
		...(worldText ? [worldText] : []),
		...(test ? [test] : []),
		"---",
		own,
		...(WITH_MANUALS.has(layer) ? [`## 手册目录\n用 Read 读，路径照下面写：\n${index}`] : []),
		...(WITH_REFERENCES.has(layer) && referenceIndex ? [`## 盖房子的参考\n${referenceIndex}不要一份份翻：设计时先 survey-terrain 看地形，再用 find-inspiration 按这块地的地形和这次想要的东西（院子、几层、码头、塔……）找两三份，只 Read 找出来的那几份。每次至少借一个大点子（形状、屋顶、院子、景观、配色），不能只借小装饰，也别照着整栋盖。`] : []),
	].join("\n\n") + "\n";

	// 检查：手册都写了“什么时候读”；设定里提到的手册都存在；提到的工具 MCP 里都有
	const warnings = [];
	if (!world) warnings.push(`config/xiaoke-body.json 没写 world（${WORLD_DIR}/ 里的哪个世界），她不知道出生点在哪`);
	else if (!worldText) warnings.push(`config 里的 world 是“${world}”，但 ${worldFile} 不存在`);
	for (const m of manuals) if (!m.when) warnings.push(`手册《${m.title}》开头没写“> 什么时候读：……”`);
	for (const r of references) {
		if (!r.hasCard) warnings.push(`参考《${r.name}》还没有 灵感.md，先不给她看`);
		else if (!r.when) warnings.push(`参考《${r.name}》的 灵感.md 开头没写“> 适合什么时候看：……”`);
		else if (!r.big) warnings.push(`参考《${r.name}》的 灵感.md 开头没写“> 大点子：……”`);
		else if (!r.tags) warnings.push(`参考《${r.name}》的 灵感.md 开头没写“> 标签：……”，find-inspiration 找不到它`);
	}
	const all = [text, ...manuals.map(m => m.text)].join("\n");
	const titles = new Set(manuals.map(m => m.title));
	for (const [, title] of all.matchAll(/手册《([^》]+)》/g)) if (!titles.has(title)) warnings.push(`提到了手册《${title}》，但 ${MANUAL_DIR}/ 里没有这本`);
	const tools = mcpToolNames();
	if (!tools) warnings.push("找不到 MCP 的代码，没法核对工具名");
	else {
		const unknown = new Set([...all.matchAll(/(?<![\w./-])[a-z]+(?:-[a-z]+)+(?![\w-])/g)].map(m => m[0]).filter(n => !tools.has(n)));
		if (unknown.size) warnings.push(`设定或手册里提到了 MCP 里没有的工具：${[...unknown].join("、")}`);
	}
	return { text, manuals, references, warnings };
}

// 直接运行时：三层都拼出来看看
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	mkdirSync(join(ROOT, "logs"), { recursive: true });
	const seen = new Set();
	for (const layer of LAYER_NAMES) {
		const { text, manuals, warnings } = buildLayerPrompt(layer, { testBot: process.argv.includes("--test") });
		writeFileSync(join(ROOT, `logs/prompt-${layer}.preview.md`), text);
		console.log(`拼好了 logs/prompt-${layer}.preview.md（${text.length} 个字）${WITH_MANUALS.has(layer) ? `，手册 ${manuals.length} 本` : ""}`);
		for (const w of warnings) if (!seen.has(w)) { seen.add(w); console.log(`检查发现：${w}`); }
	}
	if (!seen.size) console.log("检查通过");
}
