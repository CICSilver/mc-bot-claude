// node scripts/measure.mjs [logs/runs/<一局> | <记录.jsonl>]；--list 列出归档。
import { loadLogs } from './session-logs.mjs';
import { summarizeContext } from './telemetry.mjs';

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
  const context = summarizeContext(entries);
  if (!context.available) {
    console.log('本记录未采集逐步骤用量、检查点和进程重启；这些指标未知，无法还原上下文峰值');
    continue;
  }
  console.log('模型生成步骤 ' + context.modelSteps + '；有输入用量 ' + context.measuredSteps
    + '；缺少输入用量 ' + context.missingUsageSteps);
  if (context.peak) {
    const peak = context.peak;
    const time = peak.at ? new Date(peak.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '时间未记录';
    console.log('单次已上报模型步骤的输入峰值 ' + peak.contextInputTokens + '；P95 ' + context.p95InputTokens
      + '；发生于 ' + time + '；会话 ' + peak.conversationId + '；步骤 ' + peak.stepIndex);
    if (Number.isFinite(peak.inputOccupancyPercent)) {
      console.log('峰值输入占模型官方' + (peak.contextLimitKind === 'shared' ? '共享窗口' : '输入上限')
        + ' ' + peak.contextLimitTokens + ' 的 ' + peak.inputOccupancyPercent.toFixed(2)
        + '%（含缓存输入，未计本次输出；Agy 自动压缩阈值未上报）');
    } else console.log('模型窗口上限未记录，保留输入 token 实数');
  } else console.log('没有逐步骤输入样本，无法还原上下文峰值');
  console.log('检查点摘要完成 ' + context.checkpoints + '；未完成或失败 ' + context.unfinishedCheckpoints
    + '；历史压缩次数未确认，需核对检查点原始元数据');
  for (const checkpoint of context.checkpointTransitions.slice(-5)) {
    console.log('检查点 ' + checkpoint.conversationId + ':' + checkpoint.stepIndex
      + '；相邻模型步骤输入 ' + (checkpoint.beforeInputTokens ?? '缺失') + ' → '
      + (checkpoint.afterInputTokens ?? '缺失') + '（按日志先后关联，保留最近 5 条）');
  }
  console.log('进程重启 ' + context.restarts.length + '；请求新建会话 ' + context.resets.length
    + (context.resets.length ? '；原因：' + context.resets.map(e => e.reason).join('、') : ''));
  if (context.nativeEvents.length) {
    console.log('另存的 Agy 原始事件/步骤 ' + context.nativeEvents.length + '：'
      + [...new Set(context.nativeEvents.map(e => e.data?.event ?? e.nativeStep?.step_type ?? 'unknown'))].join('、'));
  }
}
