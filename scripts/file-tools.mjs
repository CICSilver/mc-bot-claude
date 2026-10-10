import { existsSync, lstatSync, realpathSync, readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const inside = (root, target) => { const part = relative(root, target); return part === '' || (!part.startsWith('..') && !isAbsolute(part)); };
export class Files {
  constructor(layer, home) {
    if (!['fast', 'exec', 'mind'].includes(layer)) throw new Error('未知层');
    this.layer = layer; this.home = realpathSync(home);
    const manual = existsSync(join(this.home, '手册')) ? '手册' : 'prompts/系统/手册';
    const reference = existsSync(join(this.home, '参考')) ? '参考' : 'prompts/小克/参考';
    this.readable = ['memory', ...(layer !== 'fast' ? [manual] : []), ...(layer === 'mind' ? [reference] : [])].map(p => join(this.home, p));
  }
  path(input, write = false) {
    if (typeof input !== 'string' || !input || input.includes('\0') || isAbsolute(input) || /^[A-Za-z]:|^\\\\/.test(input)) throw new Error('只接受项目内相对路径');
    const target = resolve(this.home, input), roots = write ? [join(this.home, 'memory')] : this.readable;
    if (write && this.layer !== 'mind') throw new Error('只有决策层可以修改记忆');
    if (!roots.some(root => inside(root, target))) throw new Error('路径越过允许范围');
    let cursor = target;
    while (!existsSync(cursor)) { const parent = dirname(cursor); if (parent === cursor) throw new Error('无效路径'); cursor = parent; }
    if (!inside(this.home, realpathSync(cursor))) throw new Error('链接指向项目外部');
    // 不接受任何符号链接或 Windows 目录联接，避免别名逃过分层目录边界。
    for (let part = target; inside(this.home, part) && part !== this.home; part = dirname(part)) {
      if (existsSync(part) && lstatSync(part).isSymbolicLink()) throw new Error('不接受链接路径');
    }
    if (write && !/\.md$/i.test(target)) throw new Error('只允许修改 Markdown 记忆');
    return target;
  }
  read(input) {
    const target = this.path(input);
    if (lstatSync(target).isDirectory()) return { content: [{ type: 'text', text: readdirSync(target).join('\n') }] };
    const bytes = readFileSync(target); if (bytes.length > 10 * 1024 * 1024) throw new Error('文件过大');
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(target).toLowerCase()];
    if (mime) return { content: [{ type: 'image', data: bytes.toString('base64'), mimeType: mime }] };
    if (!/\.(md|txt|json)$/i.test(target)) throw new Error('仅支持文本和参考图片');
    return { content: [{ type: 'text', text: bytes.toString('utf8') }] };
  }
  edit(input, oldText, newText) {
    const target = this.path(input, true);
    if (inside(join(this.home, 'memory', 'journal'), target)) throw new Error('日记只能使用 AppendJournal 追加');
    const text = readFileSync(target, 'utf8');
    if (!oldText || text.split(oldText).length !== 2) throw new Error('原文必须非空且只匹配一次，请重新读取文件');
    this.atomic(target, text.replace(oldText, newText)); return { content: [{ type: 'text', text: '记忆已更新' }] };
  }
  appendJournal(date, text) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !text.trim()) throw new Error('日期或日记无效');
    const target = this.path(`memory/journal/${date}.md`, true);
    mkdirSync(dirname(target), { recursive: true }); this.path(`memory/journal/${date}.md`, true);
    this.atomic(target, (existsSync(target) ? readFileSync(target, 'utf8') : '') + text + '\n');
    return { content: [{ type: 'text', text: '日记已追加' }] };
  }
  atomic(target, text) { const tmp = `${target}.tmp-${process.pid}`; writeFileSync(tmp, text, { flag: 'wx' }); renameSync(tmp, target); }
}
export function fileServer(layer, home) {
  const files = new Files(layer, home), server = new McpServer({ name: 'xiaoke-files', version: '0.1.0' });
  const safe = fn => async args => { try { return fn(args); } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; } };
  server.registerTool('Read', { description: '读取本层允许的记忆、手册或参考。目录返回文件名，图片返回图像。路径相对小克 home。', inputSchema: { path: z.string() } }, safe(a => files.read(a.path)));
  if (layer === 'mind') {
    server.registerTool('Edit', { description: '精确替换 memory/*.md 中唯一匹配的原文；日记禁止修改。', inputSchema: { path: z.string(), old_string: z.string(), new_string: z.string() } }, safe(a => files.edit(a.path, a.old_string, a.new_string)));
    server.registerTool('AppendJournal', { description: '按 YYYY-MM-DD 日期追加当天日记，不能改以前的内容。', inputSchema: { date: z.string(), text: z.string() } }, safe(a => files.appendJournal(a.date, a.text)));
  }
  return server;
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await fileServer(process.argv[2], process.argv[3]).connect(new StdioServerTransport());
}
