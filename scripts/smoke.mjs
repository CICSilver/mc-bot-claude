// 真实 Agy CLI 调用测试：npm run smoke -- fast [--game] [--write] [--continue]
// --game 要求身体已启动，只查询状态，不移动或修改世界。
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgyClient } from './agy-client.mjs';
import { ROOT, childEnv, ensureRuntime, findAgy, makeProfile, layerOptions } from './agy-config.mjs';
import { LayerLoop } from './layer-loop.mjs';

const args = process.argv.slice(2);
const layer = args.find(a => !a.startsWith('--')) ?? 'fast';
const game = args.includes('--game');
const resume = args.includes('--continue');
const write = args.includes('--write');

ensureRuntime();
const config = JSON.parse(readFileSync(join(ROOT, 'config/xiaoke-body.json'), 'utf8'));
const home = resolve(ROOT, config.home);
const options = layerOptions(layer, config);
const reportFile = join(ROOT, 'logs', `smoke-${layer}.json`);
const previous = resume && existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')).threadId : undefined;

const profile = makeProfile({
  layer,
  home,
  options,
  promptFile: join(ROOT, 'logs', `prompt-${layer}.md`),
  bodyUrl: `http://127.0.0.1:${config.bodyPort}`,
  conversationId: previous,
  enableMinecraftMcp: game,
});

const client = new AgyClient(findAgy(), profile.args, {
  cwd: profile.layerCwd,
  env: childEnv(),
  conversationId: previous,
});

const report = {
  layer,
  ...options,
  startedAt: new Date().toISOString(),
  game,
  resume,
  write,
  threadId: previous ?? null,
  tools: [],
  output: '',
};

client.on('diagnostic', text => process.stderr.write(text));
client.on('fatal', error => console.error(error.message));

let loop;
try {
  loop = new LayerLoop(client, previous, options, event => {
    if (event.type === 'tool_completed') {
      report.tools.push({
        server: event.server,
        tool: event.tool,
        arguments: event.arguments,
        error: event.error ?? null,
        isError: event.result?.isError ?? false,
      });
      console.log(`工具：${event.server}.${event.tool}`);
    }
    if (event.type === 'usage') report.usage = event.tokenUsage;
  });
  loop.on('session', id => {
    report.threadId = id;
  });
  loop.on('output', text => {
    report.output += text;
    process.stdout.write(text);
  });

  let request = `（启动程序的本地接入检查）按醒来步骤，先通过 call_mcp_tool 调用 files_${layer} 的 Read 工具读取 memory/self.md 和 memory/people.md，`;
  if (layer === 'mind') {
    const reference = existsSync(join(home, '参考')) ? '参考' : 'prompts/小克/参考';
    const folder = readdirSync(join(home, reference), { withFileTypes: true }).find(
      e => e.isDirectory() && readdirSync(join(home, reference, e.name)).some(n => /\.png$/i.test(n))
    );
    if (folder) {
      const image = readdirSync(join(home, reference, folder.name)).find(n => /\.png$/i.test(n));
      request += `再读取参考图片「${reference}/${folder.name}/${image}」（可用 files_${layer} 的 Read 或 view_file），简短描述看到的建筑。`;
      report.image = `${reference}/${folder.name}/${image}`;
    }
  }
  if (game) request += `再通过 call_mcp_tool 调用 minecraft_${layer} 的 get-status 和 get-position，`;
  if (write) {
    request += `再通过 call_mcp_tool 调用 files_${layer} 的 AppendJournal，date 填 ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}，追加一句“完成 Agy CLI 接入测试：记忆目录与参考图片读取正常，日记追加正常。”`;
  }
  request += '完成后仅在本窗口报告结果。此回合不用醒来流程，不发游戏聊天、不派活、不修改世界。' + (write ? '文件只追加这条测试日记。' : '不修改文件。');

  await new Promise((resolveTurn, reject) => {
    const timer = setTimeout(() => reject(new Error('模型回合超过 3 分钟')), 180000);
    loop.once('fatal', error => {
      clearTimeout(timer);
      reject(error);
    });
    loop.on('activity', event => {
      if (event === 'Stop') {
        clearTimeout(timer);
        resolveTurn();
      }
    });
    loop.enqueue(request);
  });

  report.threadId = loop.threadId ?? client.conversationId ?? report.threadId;
  const called = (server, tool) => report.tools.some(t => t.server === server && t.tool === tool && !t.error && !t.isError);
  if (!called('files', 'Read')) throw new Error('回合结束，但没有成功调用 files.Read');
  if (game && (!called('minecraft', 'get-status') || !called('minecraft', 'get-position'))) {
    throw new Error('回合结束，但没有完成两项游戏查询');
  }
  if (write && !called('files', 'AppendJournal')) throw new Error('回合结束，但没有追加测试日记');
  report.status = 'completed';
} catch (error) {
  report.status = 'failed';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await loop?.stop();
  await client.close();
  report.endedAt = new Date().toISOString();
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n结果：${report.status}；${reportFile}`);
}
