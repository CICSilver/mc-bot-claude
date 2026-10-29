// 独立本地服务器：实际协议登录、同步速度属性、破坏方块掉落、在线重载。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(root, '../../..');
const require = createRequire(join(workspace, 'minecraft-mcp-server-xiaoke/package.json'));
const mineflayer = require('mineflayer');
const { Vec3 } = require('vec3');
const dir = join(workspace, '.cache/skill-perks-test');
const java = process.env.XKB_JAVA || join(process.env.APPDATA, '.minecraft/runtime/java-runtime-epsilon/bin/java.exe');
const delay = ms => new Promise(r => setTimeout(r, ms));
const previousJar = join(dir, 'mods/skill-perks-1.0.0.jar');
if (existsSync(previousJar)) unlinkSync(previousJar);
for (const name of ['skill-perks-1.1.0.jar', 'skill-perks-probe.jar']) {
  copyFileSync(join(root, 'build', name), join(dir, 'mods', name));
}
mkdirSync(join(dir, 'config/simpleskills'), { recursive: true });
for (const kind of ['tool', 'weapon', 'armor']) {
  writeFileSync(join(dir, `config/simpleskills/${kind}_requirements.json`), '{}');
}
const defaultConfig = readFileSync(join(root, 'resources/skill-perks.json'), 'utf8');
const configPath = join(dir, 'config/skill-perks.json');
writeFileSync(configPath, defaultConfig);
const server = spawn(java, [`@${join(dir, 'launch.args')}`], { cwd: dir, windowsHide: true });
const logPath = join(dir, 'integration-server.log');
let logs = '';
const consume = data => { logs += data; writeFileSync(logPath, logs); };
server.stdout.on('data', consume);
server.stderr.on('data', consume);
let bot;
const results = [];
const record = (name, details) => { results.push({ name, ...details }); console.log(`PASS ${name}: ${JSON.stringify(details)}`); };
async function until(check, label, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = check();
    if (result) return result;
    if (server.exitCode !== null) throw new Error(`Server exited: ${server.exitCode}\n${logs.slice(-5000)}`);
    await delay(50);
  }
  throw new Error(`Timeout: ${label}\n${logs.slice(-2000)}`);
}
async function command(text) {
  server.stdin.write(text + '\n');
  await delay(300);
}
async function probe(action) {
  const start = logs.length;
  await command(`perks-probe ${action}`);
  const match = await until(() => logs.slice(start).match(/PERKS_PROBE (\{[^\r\n]*\})/), `probe ${action}`);
  return JSON.parse(match[1]);
}
async function configure(config) {
  writeFileSync(configPath, JSON.stringify(config));
  await command('skill-perks reload');
}
function speed() {
  const attrs = Object.values(bot.entity.attributes || {});
  const modifier = attrs.flatMap(a => a.modifiers || []).find(m => m.uuid === 'skill-perks:tool_speed' || m.id === 'skill-perks:tool_speed');
  return modifier?.amount || 0;
}
async function tool(name) {
  await command(`give SkillTester minecraft:${name}`);
  await bot.equip(bot.inventory.items().find(i => i.name === name), 'hand');
  await delay(400);
}
async function dig(x, material) {
  await command(`setblock ${x} 70 2 minecraft:${material}`);
  const pos = new Vec3(x, 70, 2);
  await until(() => bot.blockAt(pos)?.name === material, 'target block');
  await bot.dig(bot.blockAt(pos));
  await until(() => bot.blockAt(pos)?.name === 'air', 'block broken');
}
try {
  await until(() => logs.includes('Done ('), 'server ready', 90000);
  bot = mineflayer.createBot({ host: '127.0.0.1', port: 25630, username: 'SkillTester', auth: 'offline', version: '26.1' });
  bot.on('error', error => console.log('bot error:', error.message));
  await once(bot, 'spawn');
  await command('op SkillTester');
  await command('fill -5 69 -5 5 69 5 minecraft:stone');
  await command('tp SkillTester 0.5 70 0.5');
  await command('gamemode survival SkillTester');
  await command('clear SkillTester');
  await command('kill @e[type=minecraft:item]');
  await tool('stone_pickaxe');
  await command('simpleskills setlevel SkillTester MINING 1');
  await until(() => Math.abs(speed() - 0.01) < 1e-9, 'level 1 speed sync');
  record('level1-speed-sync', { bonus: speed() });
  await command('simpleskills setlevel SkillTester MINING 99');
  await until(() => Math.abs(speed() - 0.99) < 1e-9, 'level 99 speed sync');
  record('level99-speed-sync', { bonus: speed(), attribute: structuredClone(bot.entity.attributes['player.block_break_speed']) });

  const testConfig = JSON.parse(defaultConfig);
  testConfig.skills.MINING.speedPerLevel = 0.02;
  testConfig.skills.MINING.rewards = [{ item: 'minecraft:coal', minLevel: 1, chanceAt99: 1, count: 1 }];
  testConfig.skills.EXCAVATING.rewards = [{ item: 'minecraft:iron_nugget', minLevel: 1, chanceAt99: 1, count: 1 }];
  writeFileSync(configPath, JSON.stringify(testConfig));
  await command('skill-perks reload');
  await until(() => Math.abs(speed() - 1.98) < 1e-9, 'hot reload speed');
  record('hot-reload-speed', { bonus: speed() });
  await dig(0, 'stone');
  await command('execute as @e[type=minecraft:item] run data get entity @s Item');
  await command('data get entity SkillTester Inventory');
  assert.match(logs, /id: "minecraft:coal"/);
  assert.match(logs, /id: "minecraft:cobblestone"/);
  record('stone-extra-loot', { original: 'cobblestone', bonus: 'coal' });

  await tool('stone_shovel');
  await command('simpleskills setlevel SkillTester EXCAVATING 99');
  await until(() => Math.abs(speed() - 0.99) < 1e-9, 'shovel speed');
  await dig(1, 'dirt');
  await command('execute as @e[type=minecraft:item] run data get entity @s Item');
  await command('data get entity SkillTester Inventory');
  assert.match(logs, /id: "minecraft:iron_nugget"/);
  record('excavating-speed-and-loot', { bonus: speed(), item: 'iron_nugget' });
  await tool('stone_axe');
  await command('simpleskills setlevel SkillTester WOODCUTTING 50');
  await until(() => Math.abs(speed() - 0.50) < 1e-9, 'axe speed');
  record('woodcutting-speed', { bonus: speed() });
  await bot.unequip('hand');
  await until(() => speed() === 0, 'empty hand speed');
  record('tool-change-clears-speed', { bonus: speed() });
  writeFileSync(configPath, defaultConfig);
  await command('skill-perks reload');
  await tool('stone_pickaxe');
  await until(() => Math.abs(speed() - 0.99) < 1e-9, 'default config restored');
  record('default-config-restored', { bonus: speed() });
  for (const skill of ['SLAYING', 'RANGED', 'DEFENSE', 'ENCHANTING']) {
    await command(`simpleskills setlevel SkillTester ${skill} 99`);
  }
  const melee = await probe('melee');
  assert.ok(Math.abs(melee.damage - 14.95) < 0.0001);
  assert.ok(melee.meleeXp > 0);
  record('melee-damage', melee);
  const ranged = await probe('ranged');
  assert.ok(Math.abs(ranged.damage - 14.95) < 0.0001);
  assert.ok(ranged.rangedXp > 0);
  assert.equal(ranged.meleeXp, 0);
  record('ranged-damage-and-experience', ranged);
  const defense = await probe('defense');
  assert.ok(Math.abs(defense.damage - 8.02) < 0.0001);
  record('defense-reduction', defense);

  const baseline = JSON.parse(defaultConfig);
  baseline.enchanting.levelPreservationPerLevel = 0;
  baseline.enchanting.upgradeChancePerLevel = 0;
  await configure(baseline);
  const originalEnchant = await probe('enchant');
  const originalAnvil = await probe('anvil');
  assert.equal(originalEnchant.success, true);
  assert.equal(originalEnchant.levelsPaid, 1);
  assert.equal(originalAnvil.hasOutput, true);
  assert.equal(originalAnvil.levelsPaid, originalAnvil.cost);

  const forced = JSON.parse(defaultConfig);
  forced.combat.arrowRefundPerLevel = 1 / 99;
  forced.enchanting.levelPreservationPerLevel = 1 / 99;
  forced.enchanting.upgradeChancePerLevel = 1 / 99;
  await configure(forced);
  const ammo = await probe('ammo');
  assert.equal(ammo.consumed, 1);
  for (const name of ['minecraft:arrow', 'minecraft:spectral_arrow', 'minecraft:tipped_arrow']) assert.equal(ammo[name], 1);
  record('arrow-refund-and-potion-components', ammo);
  const enchanted = await probe('enchant');
  assert.equal(enchanted.levelsPaid, 0);
  assert.equal(enchanted.lapisPaid, originalEnchant.lapisPaid);
  const sum = entries => Object.values(entries).reduce((a, b) => a + b, 0);
  assert.equal(sum(enchanted.enchants), sum(originalEnchant.enchants) + 1);
  record('enchant-table-discount-and-quality', { before: originalEnchant, after: enchanted });
  const anvil = await probe('anvil');
  assert.equal(anvil.levelsPaid, 0);
  assert.equal(anvil.cost, originalAnvil.cost);
  record('anvil-enchantment-discount', { before: originalAnvil, after: anvil });
  writeFileSync(configPath, defaultConfig);
  await command('skill-perks reload');
} finally {
  writeFileSync(configPath, defaultConfig);
  bot?.quit();
  server.stdin.write('stop\n');
  const stopped = once(server, 'exit');
  await Promise.race([stopped, delay(15000).then(() => { if (server.exitCode === null) server.kill(); })]);
  writeFileSync(join(dir, 'integration-results.json'), JSON.stringify(results, null, 2));
}
