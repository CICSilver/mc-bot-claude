// 真实订阅调用：npm run smoke -- fast [--game] [--continue]
// --game 要求身体已启动，只查询状态，不移动或修改世界。
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AppServer, openThread } from './codex-client.mjs';
import { ROOT, childEnv, findCodex, makeProfile, layerOptions } from './codex-config.mjs';
import { LayerLoop } from './layer-loop.mjs';

const args = process.argv.slice(2), layer = args.find(a => !a.startsWith('--')) ?? 'fast';
const game = args.includes('--game'), resume = args.includes('--continue');
const write = args.includes('--write');
const config = JSON.parse(readFileSync(join(ROOT, 'config/xiaoke-body.json'), 'utf8'));
const home = resolve(ROOT, config.home), options = layerOptions(layer, config);
const profile = makeProfile({ layer, home, options, promptFile: join(ROOT, 'logs', `prompt-${layer}.md`),
  bodyUrl: `http://127.0.0.1:${config.bodyPort}`, providerOverrides: game ? [] : ['mcp_servers.minecraft.enabled=false'] });
const reportFile = join(ROOT, 'logs', `smoke-${layer}.json`);
const previous = resume ? JSON.parse(readFileSync(reportFile, 'utf8')).threadId : undefined;
const client = new AppServer(findCodex(), profile.args, { cwd: home, env: childEnv() });
const report = { layer, ...options, startedAt: new Date().toISOString(), game, resume, write, tools: [], output: '' };
client.on('diagnostic', text => process.stderr.write(text));
client.on('fatal', error => console.error(error.message));
let loop;
try {
  report.threadId = await openThread(client, { home, options, profile, threadId: previous });
  loop = new LayerLoop(client, report.threadId, options, event => {
    if (event.type === 'tool_completed') {
      report.tools.push({ server: event.server, tool: event.tool, arguments: event.arguments, error: event.error ?? null, isError: event.result?.isError ?? false });
      console.log(`工具：${event.server}.${event.tool}`);
    }
    if (event.type === 'usage') report.usage = event.tokenUsage;
  });
  loop.on('output', text => { report.output += text; process.stdout.write(text); });
  let request = '（启动程序的本地接入检查）按醒来步骤，先用文件读取工具读取 memory/self.md 和 memory/people.md，';
  if (layer === 'mind') {
    const reference = existsSync(join(home, '参考')) ? '参考' : 'prompts/小克/参考';
    const folder = readdirSync(join(home, reference), { withFileTypes: true }).find(e => e.isDirectory() && readdirSync(join(home, reference, e.name)).some(n => /\.png$/i.test(n)));
    if (folder) {
      const image = readdirSync(join(home, reference, folder.name)).find(n => /\.png$/i.test(n));
      request += `再用 files.Read 读取参考图片「${reference}/${folder.name}/${image}」，简短描述看到的建筑。`;
      report.image = `${reference}/${folder.name}/${image}`;
    }
  }
  if (game) request += '再调用 Minecraft 的 get-status 和 get-position，';
  if (write) request += `再调用 files.AppendJournal，date 填 ${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' })}，追加一句“完成 Codex 接入测试：记忆目录与参考图片读取正常，日记追加正常。”`;
  request += '完成后仅在本窗口报告结果。此回合不用醒来流程，不发游戏聊天、不派活、不修改世界。' + (write ? '文件只追加这条测试日记。' : '不修改文件。');
  await new Promise((resolveTurn, reject) => {
    const timer = setTimeout(() => reject(new Error('模型回合超过 3 分钟')), 180000);
    loop.once('fatal', error => { clearTimeout(timer); reject(error); });
    loop.on('activity', event => {
      if (event === 'Stop') { clearTimeout(timer); resolveTurn(); }
    });
    loop.enqueue(request);
  });
  const called = (server, tool) => report.tools.some(t => t.server === server && t.tool === tool && !t.error && !t.isError);
  if (!called('files', 'Read')) throw new Error('回合结束，但没有成功调用 files.Read');
  if (game && (!called('minecraft', 'get-status') || !called('minecraft', 'get-position'))) throw new Error('回合结束，但没有完成两项游戏查询');
  if (write && !called('files', 'AppendJournal')) throw new Error('回合结束，但没有追加测试日记');
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = error.message; process.exitCode = 1;
  console.error(error.message);
} finally {
  await loop?.stop(); await client.close();
  report.endedAt = new Date().toISOString();
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`\n结果：${report.status}；${reportFile}`);
}
