import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../server/datapacks/golem_recall/', import.meta.url));
const functions = join(root, 'data/golem_recall/function');
const source = name => readFileSync(join(functions, name + '.mcfunction'), 'utf8');

test('recall selects one nearby player-built golem and clears the temporary tag', () => {
  const text = source('recall');
  assert.match(text, /nbt=\{PlayerCreated:1b\},distance=\.\.32,sort=nearest,limit=1/);
  assert.ok(text.indexOf('add gr_selected') < text.indexOf('function golem_recall:find_spot'));
  assert.ok(text.lastIndexOf('remove gr_selected') > text.indexOf('function golem_recall:find_spot'));
  assert.match(source('tick'), /execute as @a\[scores=\{golem=1\.\.\}\] at @s/);
  for (const file of readdirSync(functions)) {
    const lines = readFileSync(join(functions, file), 'utf8');
    for (const [, name] of lines.matchAll(/function golem_recall:([\w/]+)/g)) assert.ok(source(name));
    assert.doesNotMatch(lines, /\b(?:setblock|fill|clone|summon|kill)\b/);
  }
});

test('landing checks cover the golem body and support at all eight candidate positions', () => {
  const offsets = [...source('landing_ok').matchAll(/unless block (~-?\d*) (~-?\d*) (~-?\d*) #golem_recall:clearance/g)]
    .map(m => m.slice(1).map(v => Number(v.slice(1)) || 0).join(','));
  const expected = [];
  for (let y = 0; y < 3; y++) for (let z = -1; z <= 1; z++) for (let x = -1; x <= 1; x++) expected.push([x,y,z].join(','));
  assert.deepEqual(offsets.sort(), expected.sort());
  assert.match(source('landing_ok'), /unless block ~ ~-1 ~ #golem_recall:floor run return 0/);
  assert.equal(source('find_spot').match(/if function golem_recall:landing_ok/g).length, 8);
  assert.match(source('arrive'), /store success score @s gr_ok run teleport @e\[type=minecraft:iron_golem,tag=gr_selected,limit=1\] ~ ~ ~/);
});
