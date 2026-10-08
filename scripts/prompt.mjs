// 把小克的设定拼成每一层的系统提示词，顺便检查几处容易对不上的地方：
//   prompts/小克/人格.md、生活.md —— 她是谁、怎么过日子（主人自己维护，两层都看）
//   prompts/系统/共用.md —— 世界、身体、两层分工、说话限制、好感度、安全（两层都看）
//   prompts/系统/快.md、慢.md —— 这一层自己的规则；测试版.md —— 测试号另加的说明
//   prompts/系统/手册/ —— 用到时再读的手册，目录只给慢的那一面（快的那一面读不了 prompts/）
// 启动器（scripts/start.mjs）每次启动都会调用；也可以单独运行看看拼出来的样子和检查结果：
//   node scripts/prompt.mjs        → 写到 logs/prompt-fast.preview.md、logs/prompt-mind.preview.md，并列出检查结果
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MANUAL_DIR = "prompts/系统/手册";
const LAYER_FILES = { fast: "prompts/系统/快.md", mind: "prompts/系统/慢.md" };
const read = path => readFileSync(join(ROOT, path), "utf8").replace(/\r\n/g, "\n");
// <!-- --> 里是写给维护的人看的说明，不给小克
const stripComments = text => text.replace(/<!--[\s\S]*?-->\n?/g, "").trim();

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

// layer: "fast" 或 "mind"；testBot: 测试号（服务器 /trigger 不认它），另加测试版说明
export function buildLayerPrompt(layer, { testBot = false } = {}) {
	const persona = stripComments(read("prompts/小克/人格.md"));
	const life = stripComments(read("prompts/小克/生活.md"));
	const shared = stripComments(read("prompts/系统/共用.md"));
	const test = testBot ? stripComments(read("prompts/系统/测试版.md")) : "";
	const own = stripComments(read(LAYER_FILES[layer]));
	const manuals = loadManuals();
	const index = manuals.map(m => `- 《${m.title}》（${m.path}）：${m.when ?? "随时可以翻翻"}`).join("\n");
	const text = [
		"以下是小克的设定。第一部分是你自己：你是谁、什么性子、怎么说话、怎么过日子。第二部分是这个世界、你的身体和两层分工的规则，最后是你这一层（反应快的那一面，或者慢慢想的那一面）自己的规则。\n" +
		"两部分说法对不上时：安全、传送、下线、工具、机制和两层分工上的限制，以第二部分为准；在这些限制之内想做什么、怎么做、做成什么样子，按第一部分你自己的性子来。",
		"---",
		persona,
		life,
		"---",
		shared,
		...(test ? [test] : []),
		"---",
		own,
		...(layer === "mind" ? [`## 手册目录\n用 Read 读，路径照下面写：\n${index}`] : []),
	].join("\n\n") + "\n";

	// 检查：手册都写了“什么时候读”；设定里提到的手册都存在；提到的工具 MCP 里都有
	const warnings = [];
	for (const m of manuals) if (!m.when) warnings.push(`手册《${m.title}》开头没写“> 什么时候读：……”`);
	const all = [text, ...manuals.map(m => m.text)].join("\n");
	const titles = new Set(manuals.map(m => m.title));
	for (const [, title] of all.matchAll(/手册《([^》]+)》/g)) if (!titles.has(title)) warnings.push(`提到了手册《${title}》，但 ${MANUAL_DIR}/ 里没有这本`);
	const tools = mcpToolNames();
	if (!tools) warnings.push("找不到 MCP 的代码，没法核对工具名");
	else {
		const unknown = new Set([...all.matchAll(/(?<![\w./-])[a-z]+(?:-[a-z]+)+(?![\w-])/g)].map(m => m[0]).filter(n => !tools.has(n)));
		if (unknown.size) warnings.push(`设定或手册里提到了 MCP 里没有的工具：${[...unknown].join("、")}`);
	}
	return { text, manuals, warnings };
}

// 直接运行时：两层都拼出来看看
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	mkdirSync(join(ROOT, "logs"), { recursive: true });
	const seen = new Set();
	for (const layer of ["fast", "mind"]) {
		const { text, manuals, warnings } = buildLayerPrompt(layer, { testBot: process.argv.includes("--test") });
		writeFileSync(join(ROOT, `logs/prompt-${layer}.preview.md`), text);
		console.log(`拼好了 logs/prompt-${layer}.preview.md（${text.length} 个字）${layer === "mind" ? `，手册 ${manuals.length} 本：${manuals.map(m => m.title).join("、")}` : ""}`);
		for (const w of warnings) if (!seen.has(w)) { seen.add(w); console.log(`检查发现：${w}`); }
	}
	if (!seen.size) console.log("检查通过");
}
