// Test-server-only acceptance: real right-click packets -> registration -> MCP -> revoke.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { RegionClient, regionTransport } from './region-data.mjs';

const execute = promisify(execFile);
const sshHost = process.env.REGION_SSH_HOST;
if (!sshHost || process.env.REGION_TEST !== '1') throw new Error('Set REGION_TEST=1 and REGION_SSH_HOST; this probe changes only the test world');
const ssh = async command => (await execute('ssh', ['-o', 'BatchMode=yes', sshHost, command], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
assert.equal(await ssh('mc-active unit'), 'minecraft-test', 'probe must run on test server');
const consoleCommand = command => ssh(`printf '%s\n' '${command.replaceAll("'", "'\\''")}' | mc-active console test`);
const require = createRequire(new URL('../../minecraft-mcp-server-xiaoke/package.json', import.meta.url));
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const out = resolve('logs/probe-regions');
mkdirSync(out, { recursive: true });
const log = [];
const bot = mineflayer.createBot({ host: process.env.REGION_GAME_HOST ?? 'mc.lemalin.icu', port: Number(process.env.REGION_GAME_PORT ?? 25565), username: 'region_probe', auth: 'offline', version: '26.1' });
bot.on('messagestr', message => { log.push(message); console.log(message); });
bot.on('error', error => console.error(error.message));
let particles = 0;
bot._client.on('world_particles', () => particles++);
const backend = new RegionClient(regionTransport());
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('scripts/region-mcp.mjs')], env: { ...process.env }, stderr: 'pipe' });
const mcp = new Client({ name: 'region-live-probe', version: '1' });
const chat = async command => { bot.chat(command); await delay(800); };
let fixturePlaced = false;
try {
  await Promise.race([once(bot, 'spawn'), delay(30_000).then(() => { throw new Error('bot spawn timeout'); })]);
  await consoleCommand('gamemode creative region_probe');
  await consoleCommand('tp region_probe 1201.5 302 1201.5');
  await delay(2000);
  await bot.waitForChunksToLoad();
  for (let x = 1199; x <= 1204; x++) for (let z = 1199; z <= 1204; z++) {
    assert.equal(bot.blockAt(new Vec3(x, 300, z))?.name, 'air', 'fixture pad must be empty');
  }
  assert.equal(bot.blockAt(new Vec3(1200, 301, 1200))?.name, 'air');
  assert.equal(bot.blockAt(new Vec3(1202, 301, 1202))?.name, 'air');
  fixturePlaced = true;
  await consoleCommand('fill 1199 300 1199 1204 300 1204 stone');
  await consoleCommand('setblock 1200 301 1200 chest[facing=north]');
  await consoleCommand('setblock 1202 301 1202 oak_stairs[facing=east,half=bottom]');
  await consoleCommand('tp region_probe 1201.5 301 1201.5');
  await delay(1500);
  await chat('/region select');
  await bot.activateBlock(bot.blockAt(new Vec3(1200, 301, 1200)));
  await delay(700);
  assert.ok(log.some(m => m.includes('已选第一个角')));
  assert.equal(bot.currentWindow, null, 'selection must not open chest');
  await bot.activateBlock(bot.blockAt(new Vec3(1203, 300, 1203)));
  await delay(1200);
  assert.ok(log.some(m => m.includes('选区 4 x 4')));
  assert.ok(particles > 0, 'selection outline particles reach player');
  await chat('/region save region_probe_home buffer 16');
  const listing = await backend.list();
  const home = listing.regions.find(r => r.id === 'region_probe_home');
  assert.deepEqual(home.bounds, { minX: 1200, minZ: 1200, maxX: 1203, maxZ: 1203 });
  assert.equal(home.buffer, 16);

  await mcp.connect(transport);
  const tools = await mcp.listTools();
  assert.equal(tools.tools.length, 4);
  const context = await mcp.callTool({ name: 'get_region_context', arguments: { region: home.id, refresh: true } });
  assert.ok(!context.isError, JSON.stringify(context));
  const summary = JSON.parse(context.content[0].text);
  writeFileSync(resolve(out, 'summary.json'), JSON.stringify(summary, null, 2));
  for (const [i, content] of context.content.filter(c => c.type === 'image').entries()) writeFileSync(resolve(out, `map-${i}.png`), Buffer.from(content.data, 'base64'));
  const exact = await mcp.callTool({ name: 'inspect_area', arguments: { region: home.id, snapshot: summary.snapshot, mode: 'blocks',
    area: { minX: 1202, maxX: 1202, minZ: 1202, maxZ: 1202, minY: 301, maxY: 301 } } });
  const block = JSON.parse(exact.content[0].text);
  assert.equal(block.palette[0].name, 'minecraft:oak_stairs');
  assert.equal(block.palette[0].properties.facing, 'east');
  writeFileSync(resolve(out, 'exact.json'), JSON.stringify(block, null, 2));
  const denied = await mcp.callTool({ name: 'inspect_area', arguments: { region: home.id, snapshot: summary.snapshot,
    area: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 } } });
  assert.equal(denied.isError, true);

  await chat('/region edit region_probe_home');
  const chest = await bot.openContainer(bot.blockAt(new Vec3(1200, 301, 1200)));
  bot.closeWindow(chest);
  await chat('/region expand east 12');
  assert.ok(log.some(m => m.includes('选区 16 x 4')));
  await chat('/region shrink south 1');
  assert.ok(log.some(m => m.includes('选区 16 x 3')));
  await chat('/region size 6 5');
  assert.ok(log.some(m => m.includes('选区 6 x 5')));
  assert.deepEqual((await backend.list()).regions.find(r => r.id === home.id), home, 'draft changes do not update MCP access');
  await chat('/region save');
  const edited = (await backend.list()).regions.find(r => r.id === home.id);
  assert.deepEqual(edited.bounds, { minX: 1200, minZ: 1200, maxX: 1205, maxZ: 1204 });
  assert.equal(edited.buffer, 16, 'editing preserves buffer');
  assert.equal(edited.owner, home.owner);
  assert.notEqual(edited.revision, home.revision);
  const stale = await mcp.callTool({ name: 'inspect_area', arguments: { region: home.id, snapshot: summary.snapshot,
    area: { minX: 1200, maxX: 1203, minZ: 1200, maxZ: 1203 } } });
  assert.equal(stale.isError, true, 'saving resized bounds invalidates old snapshots');
  await chat('/region edit region_probe_home');
  await chat('/region expand north 2');
  await chat('/region cancel');
  assert.deepEqual((await backend.list()).regions.find(r => r.id === home.id), edited, 'cancel leaves persisted region unchanged');
  writeFileSync(resolve(out, 'edited-region.json'), JSON.stringify(edited, null, 2));

  await chat('/region select');
  await bot.activateBlock(bot.blockAt(new Vec3(1200, 301, 1200)));
  await delay(700);
  await bot.activateBlock(bot.blockAt(new Vec3(1203, 300, 1203)));
  await delay(700);
  await chat('/region share region_probe_selection');
  await chat('/region edit region_probe_selection');
  await chat('/region expand west 1');
  await chat('/region save');
  const editedSelection = (await backend.list()).regions.find(r => r.id === 'region_probe_selection');
  assert.equal(editedSelection.kind, 'selection');
  assert.equal(editedSelection.buffer, 0);
  assert.equal(editedSelection.bounds.minX, 1199);
  const shared = await mcp.callTool({ name: 'get_selection_context', arguments: { selection: 'region_probe_selection' } });
  assert.ok(!shared.isError, JSON.stringify(shared));
  await chat('/region revoke region_probe_selection');
  await consoleCommand('save-all flush');
  bot.quit();
  await delay(1000);
  await ssh('systemctl restart minecraft-test');
  let restarted;
  for (let i = 0; i < 60; i++) {
    try { restarted = await backend.list(); break; } catch { await delay(1000); }
  }
  assert.ok(restarted?.regions.some(r => r.id === home.id), 'registration survives real server restart');
  assert.deepEqual(restarted.regions.find(r => r.id === home.id), edited, 'edited bounds persist across restart');
  const diskContext = await mcp.callTool({ name: 'get_region_context', arguments: { region: home.id, refresh: true } });
  assert.ok(!diskContext.isError, JSON.stringify(diskContext));
  const diskSummary = JSON.parse(diskContext.content[0].text);
  assert.ok(diskSummary.sources.disk > 0, 'offline chunks read directly from disk without a player nearby');
  assert.equal(diskSummary.sources.live, 0, 'capture did not need live chunks');
  assert.equal(diskSummary.unknownColumns, 0);
  writeFileSync(resolve(out, 'disk-summary.json'), JSON.stringify(diskSummary, null, 2));
  const diskExact = await mcp.callTool({ name: 'inspect_area', arguments: { region: home.id, snapshot: diskSummary.snapshot, mode: 'blocks',
    area: { minX: 1202, maxX: 1202, minZ: 1202, maxZ: 1202, minY: 301, maxY: 301 } } });
  assert.equal(JSON.parse(diskExact.content[0].text).palette[0].properties.facing, 'east');
  await consoleCommand('region revoke region_probe_home');
  const revoked = await mcp.callTool({ name: 'inspect_area', arguments: { region: home.id, snapshot: diskSummary.snapshot,
    area: { minX: 1200, maxX: 1203, minZ: 1200, maxZ: 1203 } } });
  assert.equal(revoked.isError, true);
  console.log('REGION_PROBE_PASS: right clicks, expand/shrink/size/edit, draft/save/cancel, MCP bounds, restart, disk-only capture and revoke');
} finally {
  await mcp.close().catch(() => {});
  if (await ssh('mc-active unit') === 'minecraft-test') {
    await consoleCommand('region delete region_probe_home');
    await consoleCommand('region delete region_probe_selection');
    if (fixturePlaced) {
      await consoleCommand('forceload add 1199 1199 1204 1204');
      await delay(1000);
      await consoleCommand('setblock 1200 301 1200 air');
      await consoleCommand('setblock 1202 301 1202 air');
      await consoleCommand('fill 1199 300 1199 1204 300 1204 air');
      await consoleCommand('forceload remove 1199 1199 1204 1204');
    }
  }
  bot.quit();
  writeFileSync(resolve(out, 'chat.log'), log.join('\n'));
}
