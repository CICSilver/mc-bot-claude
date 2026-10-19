import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AgyClient } from './agy-client.mjs';
import { LayerLoop } from './layer-loop.mjs';
import { makeStepUsage, summarizeContext, summarizeSessionUsage } from './telemetry.mjs';

const usage = (input, cached, output = 20) => ({
  input_tokens: input, cache_read_tokens: cached, output_tokens: output,
  thinking_tokens: 5, total_tokens: input + output,
});
const step = (index, input, cached) => ({
  conversation_id: 'conv-1', step_index: index, state: 'DONE', step_type: 'agent_response',
  usage: usage(input, cached), duration_seconds: 0.5,
});
const record = (index, input, cached) => makeStepUsage(step(index, input, cached), {
  conversationId: 'conv-1', turnId: 'turn-1', model: 'gemini-3.8-flash',
});

test('step input includes cache, excludes output, and identifies the model limit source', () => {
  const r = record(1, 100, 900);
  assert.equal(r.contextInputTokens, 1000);
  assert.equal(r.contextLimitTokens, 1048576);
  assert.equal(r.contextLimitSource, 'model_spec');
  assert.equal(r.inputOccupancyPercent, 1000 / 1048576 * 100);
  assert.deepEqual(r.usage, usage(100, 900));
  const argon = makeStepUsage(step(1, 1, 2), { model: 'gemini-4-argon-medium' });
  assert.equal(argon.contextLimitKind, 'shared');
});

test('missing usage stays unknown and unknown models still retain input counts', () => {
  const missing = makeStepUsage({ ...step(1, 1, 2), usage: undefined }, { model: 'gemini-3.8-flash' });
  assert.equal(missing.usage, null);
  assert.equal(missing.contextInputTokens, null);
  assert.equal(missing.inputOccupancyPercent, null);
  const partial = makeStepUsage({ ...step(1, 1, 2), usage: { input_tokens: 123 } }, {});
  assert.equal(partial.contextInputTokens, null);
  const unknown = makeStepUsage(step(1, 10, 20), { model: 'another-model' });
  assert.equal(unknown.contextInputTokens, 30);
  assert.equal(unknown.contextLimitTokens, null);
  assert.equal(unknown.inputOccupancyPercent, null);
  assert.equal(record(1, 0, 0).contextInputTokens, 0);
});

const createLoop = () => {
  const client = new EventEmitter();
  client.sendUserMessage = () => {};
  const logs = [];
  const loop = new LayerLoop(client, null, { model: 'gemini-3.8-flash' }, e => logs.push(e));
  return { client, loop, logs };
};

test('usage is captured before text and hidden-tool returns without changing activity', async () => {
  const { client, loop, logs } = createLoop();
  const activity = [], outputs = [];
  loop.on('activity', (...args) => activity.push(args));
  loop.on('output', text => outputs.push(text));
  loop.active = 'turn-1';
  const complete = { ...step(1, 100, 900), text_delta: 'hello' };
  client.emit('step_update', { ...complete, state: 'ACTIVE', usage: undefined, text_delta: 'partial' });
  client.emit('step_update', complete);
  client.emit('step_update', complete);
  client.emit('step_update', { ...step(2, 1, 2), text_delta: '' });
  client.emit('step_update', {
    ...step(3, 4, 5), step_type: 'tool', tool_name: 'view_file',
    tool_info: { parameters: { AbsolutePath: 'C:/user/.gemini/antigravity-cli/mcp/schema.json' } },
  });
  assert.equal(logs.filter(e => e.type === 'step_usage').length, 3);
  assert.deepEqual(outputs, ['partial', 'hello', 'hello']);
  assert.deepEqual(activity, []);
  assert.equal(logs.filter(e => e.type === 'tool_completed').length, 0);
  await loop.stop();
});

test('checkpoints retain native fields and unknown events without issuing control actions', async () => {
  const { client, loop, logs } = createLoop();
  let sent = 0;
  client.sendUserMessage = () => sent++;
  const checkpoint = { conversation_id: 'conv-1', step_index: 4, step_type: 'checkpoint',
    state: 'ACTIVE', native_extension: { marker: 'retained' } };
  client.emit('step_update', checkpoint);
  const done = { ...checkpoint, state: 'DONE', usage: usage(100, 0) };
  client.emit('step_update', done);
  client.emit('step_update', done);
  const future = { event: 'future_context_event', conversation_id: 'conv-1', payload: { count: 1 } };
  client.emit('notification', future);
  assert.equal(logs.filter(e => e.type === 'checkpoint').length, 2);
  assert.deepEqual(logs.findLast(e => e.type === 'checkpoint').nativeStep, done);
  assert.deepEqual(logs.find(e => e.type === 'agy_event').data, future);
  assert.equal(sent, 0);
  assert.equal(summarizeContext(logs).checkpoints, 1);
  assert.equal(summarizeContext(logs).modelSteps, 0);
  await loop.stop();
});

test('final cumulative usage keeps its conversation and does not fill missing counts with zero', async () => {
  const { client, loop, logs } = createLoop();
  loop.active = 'turn-2';
  client.emit('result', { conversation_id: 'conv-1', status: 'SUCCESS',
    num_turns: 2, duration_seconds: 4, usage: { input_tokens: 100 } });
  const r = logs.find(e => e.type === 'usage');
  assert.equal(r.conversationId, 'conv-1');
  assert.equal(r.turnId, 'turn-2');
  assert.equal(r.numTurns, 2);
  assert.equal(r.tokenUsage.total.cachedInputTokens, null);
  assert.deepEqual(r.rawUsage, { input_tokens: 100 });
  await loop.stop();
});

test('safety reset logs its cause and preserves the old ID for the next session change', async () => {
  const { client, loop, logs } = createLoop();
  const interruptions = [];
  client.interrupt = async reset => { interruptions.push(Boolean(reset)); };
  for (let turn = 1; turn <= 2; turn++) {
    loop.active = `turn-${turn}`;
    client.emit('result', { conversation_id: 'conv-1', status: 'ERROR', error: 'content safety filters' });
    await Promise.resolve();
  }
  client.emit('init', { conversation_id: 'conv-2', init: { model: 'gemini-3.8-flash' } });
  assert.deepEqual(interruptions, [false, true]);
  const reset = logs.find(e => e.type === 'conversation_reset_requested');
  assert.equal(reset.conversationId, 'conv-1');
  assert.equal(reset.reason, 'content_safety');
  const change = logs.findLast(e => e.type === 'session_changed');
  assert.equal(change.previousConversationId, 'conv-1');
  assert.equal(change.conversationId, 'conv-2');
  await loop.stop();
});

test('context report deduplicates steps and keeps checkpoint neighbors in the same conversation', () => {
  const old = record(1, 10, 90), newer = record(3, 20, 180);
  const events = [old, { type: 'checkpoint', conversationId: 'conv-1', stepIndex: 2, state: 'ACTIVE' },
    { type: 'checkpoint', conversationId: 'conv-1', stepIndex: 2, state: 'DONE', nativeStep: {} },
    newer, newer, { ...record(1, 1, 2), conversationId: 'conv-2' },
    makeStepUsage({ ...step(4, 0, 0), usage: undefined }, { conversationId: 'conv-1' })];
  const report = summarizeContext(events);
  assert.equal(report.modelSteps, 4);
  assert.equal(report.measuredSteps, 3);
  assert.equal(report.missingUsageSteps, 1);
  assert.equal(report.peak.contextInputTokens, 200);
  assert.equal(report.p95InputTokens, 200);
  assert.equal(report.checkpoints, 1);
  assert.equal(report.checkpointTransitions[0].beforeInputTokens, 100);
  assert.equal(report.checkpointTransitions[0].afterInputTokens, 200);
  assert.equal(summarizeContext([]).peak, null);
  assert.equal(summarizeContext([]).available, false);
  assert.equal(summarizeContext([{ type: 'agy_init' }]).available, true);
});

const cumulative = (id, input, cached) => ({ type: 'usage', conversationId: id,
  tokenUsage: { total: { inputTokens: input, cachedInputTokens: cached,
    outputTokens: 20, reasoningOutputTokens: 5, totalTokens: input + 20 } } });

test('session accounting preserves pre-reset totals and avoids summing cumulative samples', () => {
  const events = [cumulative('conv-1', 100, 900), cumulative('conv-1', 200, 1800),
    record(1, 50, 50), cumulative('conv-2', 10, 20), cumulative('conv-1', 300, 2700)];
  const summary = summarizeSessionUsage(events);
  assert.equal(summary.sessions, 2);
  assert.equal(summary.total.inputTokens, 310);
  assert.equal(summary.total.cachedInputTokens, 2720);
  assert.equal(summary.total.outputTokens, 40);
  const legacy = [
    { type: 'session', threadId: null }, { type: 'session_ready', threadId: 'old-1' },
    cumulative(undefined, 100, 200), cumulative(undefined, 150, 300),
    { type: 'session_ready', threadId: 'old-2' }, cumulative(undefined, 10, 20),
  ];
  assert.equal(summarizeSessionUsage(legacy).total.inputTokens, 160);
  assert.equal(summarizeSessionUsage([]), null);
});

test('telemetry listeners detach when the loop stops', async () => {
  const { client, loop } = createLoop();
  await loop.stop();
  assert.equal(client.listenerCount('notification'), 0);
  assert.equal(client.listenerCount('process_started'), 0);
});

test('client process records distinguish initial startup, resume, and conversation reset', async t => {
  const client = new AgyClient(process.execPath,
    ['-e', "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));", '--'],
    { conversationId: 'conv-1' });
  t.after(() => client.close());
  const logs = [];
  const loop = new LayerLoop(client, 'conv-1', { model: 'gemini-3.8-flash' }, e => logs.push(e));
  t.after(() => loop.stop());
  await client.interrupt();
  await client.interrupt(true);
  const processes = logs.filter(e => e.type === 'agy_process_started');
  assert.deepEqual(processes.map(e => e.reason), ['initial', 'interrupt_resume', 'conversation_reset']);
  assert.deepEqual(processes.map(e => e.processSequence), [1, 2, 3]);
  assert.deepEqual(processes.map(e => e.conversationId), ['conv-1', 'conv-1', null]);
});

test('measure and cost commands report fixtures without requiring a game or model', t => {
  const dir = mkdtempSync(join(tmpdir(), 'xiaoke-telemetry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const entries = [
    { type: 'session', provider: 'agy', model: 'gemini-3.8-flash', effort: 'low' },
    record(1, 100, 900), cumulative('conv-1', 100, 900), cumulative('conv-1', 200, 1800),
    cumulative('conv-2', 10, 20),
    { type: 'checkpoint', conversationId: 'conv-1', stepIndex: 2, state: 'DONE', nativeStep: {} },
    record(3, 10, 90),
  ];
  writeFileSync(join(dir, 'fast.jsonl'), entries.map(e => JSON.stringify({ at: '2026-10-19T00:00:00Z', ...e })).join('\n'));
  const measure = execFileSync(process.execPath, ['scripts/measure.mjs', dir], { encoding: 'utf8', windowsHide: true });
  const cost = execFileSync(process.execPath, ['scripts/cost.mjs', dir], { encoding: 'utf8', windowsHide: true });
  assert.match(measure, /1000/);
  assert.match(measure, /1048576/);
  assert.match(measure, /conv-1/);
  assert.match(cost, /210/);
  assert.match(cost, /1820/);
  assert.match(cost, /2070/);
});
