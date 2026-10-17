// npm run watch：实时显示游戏发言、四层输出及任务交接。
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './agy-config.mjs';

process.title = '小克 Agy - 实时说话日志';
const labels = { fast: '快层', exec: '执行', mind: '调度', planner: '规划' };
const output = new Map();
function show(e) {
  const time = new Date(e.at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const print = (label, text) => console.log('[' + time + '] [' + label + '] ' + text);
  if (e.type === 'input' && e.layer === 'fast' && e.text.includes('[环境]')) print('环境变化', e.text.split('　')[0]);
  if (e.type === 'output') output.set(e.layer, (output.get(e.layer) ?? '') + e.text);
  if (e.type === 'turn_completed') {
    const text = output.get(e.layer)?.trim();
    if (text) print(labels[e.layer] + ' · 控制台', text);
    output.delete(e.layer);
    if (e.status === 'failed') print(labels[e.layer] + ' · 错误', e.error?.message ?? '回合失败');
  }
  if (e.type === 'tool_completed') {
    const a = e.arguments ?? {};
    if (e.error || e.result?.isError) print(labels[e.layer] + ' · 工具失败', e.tool + ' ' + (e.error?.message ?? JSON.stringify(e.result?.content)));
    else if (e.tool === 'send-chat') print('游戏发言 · 小克', a.message);
    else if (e.tool === 'pass-to-mouth') print('决策 → 快层', a.say);
    else if (e.tool === 'assign-task') print('派活', a.goal);
    else if (e.tool === 'report-task') print('执行汇报 #' + a.id + ' ' + a.kind, a.text);
    else if (e.tool === 'request-plan') print('调度 → 规划', a.brief);
    else if (e.tool === 'report-plan') print('规划 → 调度 #' + a.id, a.summary);
    else if (e.tool === 'stop-work') print('立即停工', a.action + ' ' + a.reason);
    else if (e.tool === 'AppendJournal') print('日记', a.text);
  }
  if (e.type === 'fatal') print(labels[e.layer] + ' · 错误', e.message);
  if (e.type === 'turn_interrupted') print(labels[e.layer] + ' · 已中断', e.text);
  if (e.type === 'session') print(labels[e.layer] + ' · 已连接', e.model + ' / ' + e.effort);
}
const sources = Object.keys(labels).map(layer => ({ file: join(ROOT, 'logs', layer + '.jsonl'), offset: 0, pending: '' }));
const parse = text => text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
console.log('小克实时日志：游戏发言 / 四层控制台 / 派活汇报。关闭本窗口不会停止机器人。\n');
const history = [];
for (const source of sources) if (existsSync(source.file)) {
  const data = readFileSync(source.file); source.offset = data.length;
  const entries = parse(data.toString('utf8'));
  const start = entries.findLastIndex(e => e.type === 'session');
  history.push(...entries.slice(Math.max(0, start)));
}
history.sort((a, b) => a.at.localeCompare(b.at)).forEach(show);
console.log('\n—— 正在实时监控 ——\n');
setInterval(() => {
  const events = [];
  for (const source of sources) {
    if (!existsSync(source.file)) continue;
    const size = statSync(source.file).size;
    if (size < source.offset) { source.offset = 0; source.pending = ''; }
    if (size === source.offset) continue;
    const bytes = Buffer.alloc(size - source.offset), fd = openSync(source.file, 'r');
    try { readSync(fd, bytes, 0, bytes.length, source.offset); } finally { closeSync(fd); }
    source.offset = size;
    const text = source.pending + bytes.toString('utf8'), end = text.lastIndexOf('\n');
    source.pending = text.slice(end + 1);
    events.push(...parse(text.slice(0, end + 1)));
  }
  events.sort((a, b) => a.at.localeCompare(b.at)).forEach(show);
}, 400);
