// node scripts/measure.mjs [logs/runs/<一局> | <记录.jsonl>]；--list 列出归档。
import { loadLogs } from './session-logs.mjs';

const seconds = xs => xs.length ? (xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] / 1000).toFixed(1) + 's' : '-';
for (const { name, entries } of loadLogs(process.argv.slice(2))) {
  const turns = new Map(), firstOutput = [], durations = [];
  for (const e of entries) {
    if (e.type === 'turn_started') turns.set(e.turnId, { start: Date.parse(e.at) });
    const turn = turns.get(e.turnId);
    if (e.type === 'output' && turn && !turn.output) { turn.output = true; firstOutput.push(Date.parse(e.at) - turn.start); }
    if (e.type === 'turn_completed' && turn) durations.push(Date.parse(e.at) - turn.start);
  }
  const session = entries.findLast(e => e.type === 'session');
  const tools = entries.filter(e => e.type === 'tool_completed');
  console.log('\n' + name + '：' + (session?.model ?? '?') + ' / ' + (session?.effort ?? '?'));
  console.log('输入事件 ' + entries.filter(e => e.type === 'input').length + '；回合 ' + durations.length + '；忙碌时排队 ' + entries.filter(e => e.type === 'queued' || e.type === 'steered').length);
  console.log('回合首段输出中位 ' + seconds(firstOutput) + '；回合耗时中位 ' + seconds(durations));
  console.log('工具调用 ' + tools.length + '；失败 ' + tools.filter(e => e.error || e.result?.isError).length + '；游戏发言 ' + tools.filter(e => e.tool === 'send-chat' && !e.error && !e.result?.isError).length);
  console.log('回合失败 ' + entries.filter(e => e.type === 'turn_completed' && e.status === 'failed').length + '；进程错误 ' + entries.filter(e => e.type === 'fatal').length);
}
