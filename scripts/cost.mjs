// 显示 Codex 实际返回的 token 和账号额度，不换算 API 账单。
import { loadLogs } from './session-logs.mjs';

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
  const usage = entries.findLast(e => e.type === 'usage')?.tokenUsage?.total;
  const limits = entries.filter(e => e.type === 'rate_limits');
  console.log('\n' + name + '（该会话累计用量，续接包含之前的对话）：');
  if (usage) console.log('输入 ' + usage.inputTokens + '；其中缓存 ' + usage.cachedInputTokens + '；输出 ' + usage.outputTokens + '；其中思考 ' + usage.reasoningOutputTokens + '；总计 ' + usage.totalTokens);
  else console.log('尚无用量数据');
  if (limits.length) {
    console.log('账号额度快照（含其他 Codex 会话的使用）：');
    for (const item of limits.length > 1 ? [limits[0], limits.at(-1)] : limits) console.log(item.at + ' ' + describe(item.rateLimits));
  }
}
