import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { ROOT } from './agy-config.mjs';
import { buildToolGuide } from './tool-guide.mjs';
import { fileServer } from './file-tools.mjs';

const bodyRoot = resolve(ROOT, JSON.parse(readFileSync(join(ROOT, 'config/xiaoke-body.json'), 'utf8')).mcp);
const bodyModule = file => import(pathToFileURL(join(bodyRoot, 'dist', file)).href);
const { roleAllows } = await bodyModule('roles.js');
const { registerStepTools, checkSteps } = await bodyModule('tools/steps-tools.js');
const modules = await Promise.all(readdirSync(join(bodyRoot, 'dist/tools'))
  .filter(file => file.endsWith('-tools.js') && file !== 'steps-tools.js')
  .map(file => bodyModule(`tools/${file}`)));

function captureTools(layer) {
  const tools = new Map();
  const factory = { registerTool: (name, description, schema) => tools.set(name, { description, schema }) };
  const getBot = () => { throw new Error('Contract checks only register tools'); };
  for (const module of modules) {
    for (const [name, register] of Object.entries(module)) {
      if (!/^register.*Tools$/.test(name)) continue;
      if (name === 'registerChatTools') {
        register(factory, getBot, {}, undefined, layer === 'mind' || layer === 'exec', {});
      } else if (name === 'registerSessionTools') {
        register(factory, getBot, {}, () => {}, async () => '');
      } else if (name === 'registerBuildingLibraryTools') {
        register(factory, getBot, undefined, undefined, join(ROOT, 'building-library'));
      } else {
        register(factory, getBot);
      }
    }
  }
  registerStepTools(factory, {}, tools);
  return tools;
}

for (const layer of ['fast', 'exec', 'mind', 'planner']) {
  test(`${layer} guide examples match registered tool schemas and role access`, () => {
    const tools = captureTools(layer);
    const files = fileServer(layer, ROOT);
    const examples = [...buildToolGuide(layer).matchAll(/`([A-Za-z][A-Za-z0-9-]*)`: `(\{[^`\n]*\})`/g)];
    assert.ok(examples.length >= 10);
    for (const [, name, json] of examples) {
      const args = JSON.parse(json);
      if (/^[A-Z]/.test(name)) {
        const fileTool = files._registeredTools[name];
        assert.ok(fileTool, `${layer}: files.${name}`);
        const result = fileTool.inputSchema.strict().safeParse(args);
        assert.equal(result.success, true, `${layer}: files.${name}: ${result.error?.message}`);
      } else {
        const tool = tools.get(name);
        assert.ok(tool, name);
        assert.ok(roleAllows(layer, name), `${layer}: ${name}`);
        const result = z.object(tool.schema).strict().safeParse(args);
        assert.equal(result.success, true, `${layer}: ${name}: ${result.error?.message}`);
        if (name === 'do-steps') assert.deepEqual(checkSteps(args.steps, tools), []);
      }
    }
  });
}

test('executor walking uses the body default in direct and background examples', () => {
  const guide = buildToolGuide('exec');
  const examples = [...guide.matchAll(/`([a-z-]+)`: `(\{[^`\n]*\})`/g)];
  const move = JSON.parse(examples.find(([, name]) => name === 'move-to-position')[2]);
  const steps = JSON.parse(examples.find(([, name]) => name === 'do-steps')[2]);
  assert.equal(move.timeoutMs, undefined);
  assert.equal(steps.steps[0].args.timeoutMs, undefined);
  for (const file of ['prompts/系统/执行.md', 'prompts/系统/手册/出门在外.md']) {
    assert.doesNotMatch(readFileSync(join(ROOT, file), 'utf8'), /timeoutMs 最多填 5000/);
  }
});
