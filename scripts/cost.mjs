// 显示服务返回的会话累计 token 和账号额度，不换算 API 账单。
import { loadLogs } from './session-logs.mjs';
import { summarizeSessionUsage } from './telemetry.mjs';

function describe(snapshot) {
  const rates = snapshot.rateLimitsByLimitId ?? (snapshot.rateLimits ? { codex: snapshot.rateLimits } : snapshot);
  return Object.entries(rates).flatMap(([name, rate]) => ['primary', 'secondary'].flatMap(key => {
    const window = rate?.[key];
    if (!window) return [];
    const minutes = window.windowDurationMins;
    const duration = minutes % 1440 === 0 ? minutes / 1440 + '天' : minutes % 60 === 0 ? minutes / 60 + '小时' : minutes + '分钟';
    const reset = new Date(window.resetsAt * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    return [name + ' ' + duration + '窗口已用 ' + window.usedPercent + '%，重置 ' + reset];
  })).join('；');
}

for (const { name, entries } of loadLogs(process.argv.slice(2))) {
  const summary = summarizeSessionUsage(entries);
  const usage = summary?.total;
  const limits = entries.filter(e => e.type === 'rate_limits');
  console.log('\n' + name + '（记录涉及的 ' + (summary?.sessions ?? 0) + ' 个会话累计用量，续接包含之前的对话）：');
  const number = value => value === null ? '未上报' : value;
  if (usage) {
    const agy = entries.some(e => e.provider === 'agy' || e.usageScope === 'conversation');
    console.log((agy ? '非缓存输入 ' : '输入 ') + number(usage.inputTokens)
      + (agy ? '；缓存输入 ' : '；其中缓存 ') + number(usage.cachedInputTokens)
      + '；输出 ' + number(usage.outputTokens) + '；其中思考 ' + number(usage.reasoningOutputTokens)
      + '；服务累计 total ' + number(usage.totalTokens));
    if (agy && [usage.inputTokens, usage.cachedInputTokens, usage.outputTokens].every(Number.isFinite)) {
      console.log('含缓存读取的累计处理量 ' + (usage.inputTokens + usage.cachedInputTokens + usage.outputTokens)
        + '（输出已含思考；累计处理量不作为上下文占用）');
    }
  }
  else console.log('尚无用量数据');
  if (limits.length) {
    console.log('账号额度快照（含其他 Codex 会话的使用）：');
    for (const item of limits.length > 1 ? [limits[0], limits.at(-1)] : limits) console.log(item.at + ' ' + describe(item.rateLimits));
  }
}
