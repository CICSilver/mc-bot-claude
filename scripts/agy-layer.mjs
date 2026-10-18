import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { AgyClient } from './agy-client.mjs';
import { ROOT, childEnv, ensureRuntime, findAgy, layerOptions, makeProfile } from './agy-config.mjs';
import { LayerLoop } from './layer-loop.mjs';
import { buildStartupMemory } from './prompt.mjs';

const layer = process.argv[2];
const config = JSON.parse(readFileSync(join(ROOT, 'config/xiaoke-body.json'), 'utf8'));
const home = resolve(ROOT, process.env.XIAOKE_HOME || config.home || '.');
const bodyUrl = `http://127.0.0.1:${Number(process.env.XIAOKE_BODY_PORT || config.bodyPort) || 25598}`;
const options = layerOptions(layer, config);
const promptFile = join(ROOT, 'logs', `prompt-${layer}.md`);
const sessionFile = join(ROOT, '.runtime', `session-${layer}.json`);
const transcript = join(ROOT, 'logs', `${layer}.jsonl`);

ensureRuntime();
mkdirSync(join(ROOT, 'logs'), { recursive: true });
const log = event => appendFileSync(transcript, JSON.stringify({ at: new Date().toISOString(), layer, ...event }) + '\n');

let previousId;
if (process.env.XIAOKE_RESUME === '1') {
  if (!existsSync(sessionFile)) throw new Error('没有本层 Agy 会话，先不带 --continue 启动。');
  const saved = JSON.parse(readFileSync(sessionFile, 'utf8'));
  previousId = saved.threadId;
}

const profile = makeProfile({
  layer,
  home,
  bodyUrl,
  promptFile,
  options,
  conversationId: previousId,
});

const client = new AgyClient(findAgy(), profile.args, {
  cwd: profile.layerCwd,
  env: childEnv(),
  conversationId: previousId,
});

let loop, socket, heartbeat, parentWatch, closing = false;
const parentPid = Number(process.env.XIAOKE_LAYER_PARENT_PID);
const parentAlive = () => {
  if (!parentPid) return true;
  try { process.kill(parentPid, 0); return true; } catch { return false; }
};

function saveSession(threadId) {
  if (!threadId) return;
  writeFileSync(sessionFile + '.tmp', JSON.stringify({ threadId, ...options }, null, 2));
  renameSync(sessionFile + '.tmp', sessionFile);
  log({ type: 'session_ready', provider: 'agy', threadId, ...options });
  console.log(`${layer}：${options.model} / ${options.effort}；Agy 会话 ${threadId}`);
}

async function hook(event, tool = '') {
  if (layer === 'fast') return;
  try {
    const r = await fetch(`${bodyUrl}/hook?layer=${layer}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hook_event_name: event, tool_name: tool }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error(`身体拒绝生命周期通知 (${r.status})`);
  } catch (error) {
    if (!closing) {
      log({ type: 'hook_warning', event, tool, message: error.message });
    }
  }
}

async function shutdown(error) {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  clearInterval(parentWatch);
  if (error) {
    console.error(`\n${layer} 停止：${error.message}`);
    log({ type: 'fatal', message: error.message });
  }
  socket?.close();
  await loop?.stop();
  await hook('StopFailure').catch(() => {});
  await client.close();
  process.exit(error ? 1 : 0);
}

client.on('fatal', error => void shutdown(error));
client.on('diagnostic', message => appendFileSync(join(ROOT, 'logs', `agy-${layer}.log`), message));
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
  log({ type: 'session', provider: 'agy', threadId: previousId ?? null, ...options });
  if (previousId) saveSession(previousId);
  loop = new LayerLoop(client, previousId, options, log);
  loop.on('session', id => saveSession(id));
  loop.on('activity', (event, tool) => void hook(event, tool));
  loop.on('fatal', error => void shutdown(error));
  loop.on('output', text => process.stdout.write(text));
  loop.on('tool', info => {
    const argPreview = JSON.stringify(info.arguments ?? {});
    const shortArgs = argPreview.length > 90 ? argPreview.slice(0, 87) + '...' : argPreview;
    console.log(`  → [${info.server}.${info.tool}] ${shortArgs}`);
  });

  heartbeat = setInterval(() => {
    if (loop.active) void hook('PreToolUse', 'Read');
  }, 15000);

  if (parentPid) {
    parentWatch = setInterval(() => {
      if (!parentAlive()) void shutdown();
    }, 1000);
  }

  socket = new WebSocket(`ws://127.0.0.1:${Number(process.env.EAR_PORT || config.earPort) || 25599}/${layer}`);
  socket.addEventListener('message', async event => {
    const text = String(event.data);
    if (text.startsWith('{')) {
      const control = JSON.parse(text);
      if (control.type === 'interrupt') {
        await loop.interrupt(control.text, control.resume);
        socket.send(JSON.stringify({ type: 'interrupt_done', id: control.id }));
        return;
      }
    }
    loop.enqueue(text);
  });
  socket.addEventListener('error', () => {
    if (!closing) void shutdown(parentAlive() ? new Error('耳朵连接失败') : undefined);
  });
  socket.addEventListener('close', () => {
    if (!closing) void shutdown(parentAlive() ? new Error('耳朵连接已断开') : undefined);
  });

  if (!previousId) {
    console.log(`${layer}：${options.model} / ${options.effort}；正在初始化 Agy 会话……`);
  }
  const startupMemory = (layer === 'fast' || layer === 'mind' || layer === 'planner') ? `\n\n${buildStartupMemory(home, layer)}` : '';
  if (layer !== 'planner') {
    loop.enqueue(
      `（启动程序）小克醒来啦。现在是 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。你是${{ fast: '反应快', exec: '动手做事', mind: '拿主意' }[layer]}的那一面，按“醒来时”的步骤开始。事件监听已由启动器准备，无需调用监听工具。${startupMemory}`
    );
  } else if (!previousId) {
    loop.enqueue(
      `（启动程序）小克醒来啦。现在是 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}。你是后台规划与整理的那一面，请按醒来规划流程先用 set-todos 整理今日心愿待办清单，并写一段简短醒来日记，再通过 report-plan 告诉调度脑。${startupMemory}`
    );
  }

  createInterface({ input: process.stdin }).on('line', text => {
    if (text.trim() === '/quit') void shutdown();
    else if (text.trim()) loop.enqueue(`（坐在电脑前的主人）${text}`);
  });
} catch (error) {
  await shutdown(error);
}
