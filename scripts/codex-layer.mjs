import { appendFileSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { AppServer, openThread } from './codex-client.mjs';
import { ROOT, childEnv, findCodex, makeProfile, layerOptions } from './codex-config.mjs';
import { LayerLoop } from './layer-loop.mjs';
import { buildStartupMemory } from './prompt.mjs';

const layer = process.argv[2], config = JSON.parse(readFileSync(join(ROOT, 'config/xiaoke-body.json'), 'utf8'));
const home = resolve(ROOT, process.env.XIAOKE_HOME || config.home || '.'), bodyUrl = `http://127.0.0.1:${Number(process.env.XIAOKE_BODY_PORT || config.bodyPort) || 25598}`;
const options = layerOptions(layer, config), promptFile = join(ROOT, 'logs', `prompt-${layer}.md`);
const profile = makeProfile({ layer, home, bodyUrl, promptFile, options });
const sessionFile = join(ROOT, '.runtime', `session-${layer}.json`), transcript = join(ROOT, 'logs', `${layer}.jsonl`);
const log = event => appendFileSync(transcript, JSON.stringify({ at: new Date().toISOString(), layer, ...event }) + '\n');
const client = new AppServer(findCodex(), profile.args, { cwd: home, env: childEnv() });
let loop, socket, heartbeat, parentWatch, closing = false;
async function hook(event, tool = '') {
  if (layer === 'fast') return;
  await fetch(`${bodyUrl}/hook?layer=${layer}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hook_event_name: event, tool_name: tool }), signal: AbortSignal.timeout(2000) }).then(r => { if (!r.ok) throw new Error('身体拒绝生命周期通知'); });
}
async function shutdown(error) {
  if (closing) return; closing = true; clearInterval(heartbeat); clearInterval(parentWatch);
  if (error) { console.error(`\n${layer} 停止：${error.message}`); log({ type: 'fatal', message: error.message }); }
  socket?.close(); await loop?.stop(); await hook('StopFailure').catch(() => {});
  await client.close(); process.exit(error ? 1 : 0);
}
client.on('fatal', error => void shutdown(error));
client.on('diagnostic', message => appendFileSync(join(ROOT, 'logs', `codex-${layer}.log`), message));
client.on('denied', method => log({ type: 'denied', method }));
process.on('SIGINT', () => void shutdown()); process.on('SIGTERM', () => void shutdown());
try {
  let previousId;
  if (process.env.XIAOKE_RESUME === '1') {
    if (!existsSync(sessionFile)) throw new Error('没有本层 Codex 会话，先不带 --continue 启动。');
    const saved = JSON.parse(readFileSync(sessionFile, 'utf8'));
    previousId = saved.threadId;
  }
  const threadId = await openThread(client, { home, options, profile, threadId: previousId });
  writeFileSync(sessionFile + '.tmp', JSON.stringify({ threadId, ...options }, null, 2)); renameSync(sessionFile + '.tmp', sessionFile);
  log({ type: 'session', provider: 'codex', threadId, ...options });
  loop = new LayerLoop(client, threadId, options, log);
  void client.request('account/rateLimits/read').then(result => log({ type: 'rate_limits', rateLimits: result.rateLimitsByLimitId ?? result.rateLimits }), error => console.warn(`额度暂时不可用：${error.message}`));
  loop.on('activity', (event, tool) => void hook(event, tool).catch(error => void shutdown(error)));
  loop.on('fatal', error => void shutdown(error)); loop.on('output', text => process.stdout.write(text));
  heartbeat = setInterval(() => { if (loop.active) void hook('PreToolUse', 'Read').catch(error => void shutdown(error)); }, 15000);
  const parentPid = Number(process.env.XIAOKE_LAYER_PARENT_PID);
  if (parentPid) parentWatch = setInterval(() => {
    try { process.kill(parentPid, 0); } catch { void shutdown(); }
  }, 1000);
  socket = new WebSocket(`ws://127.0.0.1:${Number(process.env.EAR_PORT || config.earPort) || 25599}/${layer}`);
  socket.addEventListener('message', event => loop.enqueue(String(event.data)));
  socket.addEventListener('error', () => void shutdown(new Error('耳朵连接失败')));
  socket.addEventListener('close', () => { if (!closing) void shutdown(new Error('耳朵连接已断开')); });
  console.log(`${layer}：${options.model} / ${options.effort}；Codex 会话 ${threadId}`);
  const startupMemory = layer === 'fast' ? `\n\n${buildStartupMemory(home)}` : '';
  loop.enqueue(`（启动程序）小克醒来啦。现在是 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。你是${{ fast: '反应快', exec: '动手做事', mind: '拿主意' }[layer]}的那一面，按“醒来时”的步骤开始。事件监听已由启动器准备，无需调用监听工具。${startupMemory}`);
  createInterface({ input: process.stdin }).on('line', text => {
    if (text.trim() === '/quit') void shutdown();
    else if (text.trim()) loop.enqueue(`（坐在电脑前的主人）${text}`);
  });
} catch (error) { await shutdown(error); }
