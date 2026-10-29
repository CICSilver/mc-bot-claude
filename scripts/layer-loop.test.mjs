import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { LayerLoop } from './layer-loop.mjs';

class MockAgyClient extends EventEmitter {
  messages = [];
  conversationId = null;
  interruptions = 0;
  async interrupt() { this.interruptions++; }
  async sendUserMessage(text) {
    this.messages.push(text);
    if (this.onSend) this.onSend(text);
  }
  complete(conversationId = 'conv-1', status = 'SUCCESS', error) {
    this.emit('result', {
      conversation_id: conversationId,
      status,
      error,
      usage: { input_tokens: 100, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 50, total_tokens: 120 },
    });
  }
}

const create = () => {
  const client = new MockAgyClient();
  const logs = [];
  const loop = new LayerLoop(client, null, { model: 'gemini-3.8-flash', effort: 'low' }, e => logs.push(e));
  return { client, loop, logs };
};

test('a run of twelve queries yields to the dispatcher with the task preserved', async () => {
  const { client, loop, logs } = create();
  loop.options.layer = 'exec';
  const blocked = [];
  loop.on('blocked', message => blocked.push(message));
  loop.enqueue('选择猫雕像位置');
  await setImmediate();
  for (let index = 1; index <= 12; index++) {
    client.emit('step_update', { conversation_id: 'conv-1', step_index: index, state: 'DONE', step_type: 'tool', tool_name: 'call_mcp_tool',
      tool_info: { name: 'call_mcp_tool', parameters: { ServerName: 'minecraft_exec', ToolName: 'get-block-info', Arguments: { x: index, y: 64, z: 0 } }, output: 'air' } });
  }
  await setImmediate();
  assert.equal(client.interruptions, 1);
  assert.equal(loop.active, null);
  assert.equal(blocked.length, 1);
  assert.equal(logs.find(e => e.type === 'query_yield').queryCount, 12);
  loop.enqueue('原任务改为送鱼上船');
  await setImmediate();
  assert.match(client.messages.at(-1), /送鱼上船/);
  await loop.stop();
});

test('events arriving while a turn is active are batched into the next turn after result', async () => {
  const { client, loop, logs } = create();
  loop.enqueue('玩家打招呼');
  await setImmediate();
  assert.equal(client.messages.length, 1);
  assert.equal(client.messages[0], '玩家打招呼');
  assert.ok(loop.active);

  loop.enqueue('玩家递来一条鱼');
  loop.enqueue('玩家冲你挥了挥手');
  await setImmediate();
  assert.equal(client.messages.length, 1);
  assert.equal(logs.filter(e => e.type === 'queued').length, 2);

  client.complete('conv-123');
  await setImmediate();
  assert.equal(loop.threadId, 'conv-123');
  assert.equal(client.messages.length, 2);
  assert.equal(client.messages[1], '玩家递来一条鱼\n玩家冲你挥了挥手');

  client.complete('conv-123');
  assert.equal(loop.active, null);
  await loop.stop();
});

test('MCP tool step_update events emit PreToolUse/PostToolUse and normalized tool logs', async () => {
  const { client, loop, logs } = create();
  const activities = [];
  loop.on('activity', (event, tool) => activities.push({ event, tool }));

  loop.enqueue('检查状态');
  await setImmediate();

  client.emit('step_update', {
    conversation_id: 'conv-1',
    step_index: 1,
    state: 'ACTIVE',
    step_type: 'tool',
    tool_name: 'call_mcp_tool',
    tool_info: {
      name: 'call_mcp_tool',
      parameters: { ServerName: 'files_fast', ToolName: 'Read', Arguments: { path: 'memory/self.md' } },
    },
  });
  client.emit('step_update', {
    conversation_id: 'conv-1',
    step_index: 1,
    state: 'DONE',
    step_type: 'tool',
    tool_name: 'call_mcp_tool',
    tool_info: {
      name: 'call_mcp_tool',
      parameters: { ServerName: 'files_fast', ToolName: 'Read', Arguments: { path: 'memory/self.md' } },
      output: '# 小克',
    },
  });
  client.emit('step_update', {
    conversation_id: 'conv-1',
    step_index: 2,
    state: 'ACTIVE',
    step_type: 'tool',
    tool_name: 'call_mcp_tool',
    tool_info: {
      name: 'call_mcp_tool',
      parameters: { ServerName: 'minecraft_fast', ToolName: 'send-chat', Arguments: { message: '你好呀' } },
    },
  });
  client.emit('step_update', {
    conversation_id: 'conv-1',
    step_index: 2,
    state: 'DONE',
    step_type: 'tool',
    tool_name: 'call_mcp_tool',
    tool_info: {
      name: 'call_mcp_tool',
      parameters: { ServerName: 'minecraft_fast', ToolName: 'send-chat', Arguments: { message: '你好呀' } },
      output: 'ok',
    },
  });

  client.complete('conv-1');
  await setImmediate();

  assert.deepEqual(activities, [
    { event: 'UserPromptSubmit', tool: '' },
    { event: 'PreToolUse', tool: 'Read' },
    { event: 'PostToolUse', tool: 'Read' },
    { event: 'PreToolUse', tool: 'mcp__minecraft__send-chat' },
    { event: 'PostToolUse', tool: 'mcp__minecraft__send-chat' },
    { event: 'Stop', tool: '' },
  ]);

  const completedTools = logs.filter(e => e.type === 'tool_completed');
  assert.equal(completedTools.length, 2);
  assert.equal(completedTools[0].server, 'files');
  assert.equal(completedTools[0].tool, 'Read');
  assert.equal(completedTools[1].server, 'minecraft');
  assert.equal(completedTools[1].tool, 'send-chat');
  await loop.stop();
});

test('stop request interrupts the running work and replaces queued events with the latest request', async () => {
  const { client, loop, logs } = create();
  loop.enqueue('制作楼梯');
  await setImmediate();
  loop.enqueue('继续盖码头');
  await loop.interrupt('玩家要求下线，身体已停工', true);
  await setImmediate();
  assert.equal(client.interruptions, 1);
  assert.equal(client.messages.length, 2);
  assert.match(client.messages[1], /玩家要求下线/);
  assert.equal(client.messages[1].includes('继续盖码头'), false);
  assert.equal(logs.filter(e => e.type === 'turn_interrupted').length, 1);
  await loop.stop();
});

test('paused executor waits for a new task and carries the stop notice into that task', async () => {
  const { client, loop } = create();
  loop.enqueue('取材料并建造');
  await setImmediate();
  await loop.interrupt('暂停施工，等玩家继续', false);
  assert.equal(client.messages.length, 1);
  assert.equal(loop.active, null);
  loop.enqueue('玩家说继续，读取当前任务');
  await setImmediate();
  assert.equal(client.messages.length, 2);
  assert.match(client.messages[1], /暂停施工/);
  assert.match(client.messages[1], /玩家说继续/);
  await loop.stop();
});

test('idle dispatcher handles urgent control in its warm conversation', async () => {
  const { client, loop } = create();
  loop.enqueue('普通请求');
  await setImmediate();
  client.complete();
  await loop.interrupt('下线收尾', true);
  await setImmediate();
  assert.equal(client.interruptions, 0);
  assert.match(client.messages.at(-1), /下线收尾/);
  await loop.stop();
});

test('recovered and historical errors settle successful new steps in the same conversation', async () => {
  const { client, loop, logs } = create();
  const step = (index, type) => client.emit('step_update', {
    conversation_id: 'conv-1', step_index: index, step_type: type, state: 'DONE',
  });
  loop.enqueue('把钻石存好');
  await setImmediate();
  step(153, 'error_message');
  step(160, 'agent_response');
  client.complete('conv-1', 'ERROR', 'API error: INTERNAL (code 500)');
  loop.enqueue('取两块楼梯');
  await setImmediate();
  step(172, 'agent_response');
  client.complete('conv-1', 'ERROR', 'API error: INTERNAL (code 500)');
  assert.deepEqual(logs.filter(e => e.type === 'turn_completed').map(e => [e.status, e.resultKind]),
    [['completed', 'recovered'], ['completed', 'historical_error']]);
  assert.equal(client.interruptions, 0);
  assert.equal(loop.consecutiveFailures, 0);
  await loop.stop();
});

test('transport failure retries the current work and batches events during process recovery', async () => {
  const { client, loop, logs } = create();
  loop.options.retryDelays = [0, 0];
  let release;
  client.interrupt = () => new Promise(resolve => { client.interruptions++; release = resolve; });
  loop.enqueue('砍木头再送回');
  await setImmediate();
  client.complete('conv-1', 'ERROR', 'connection closed');
  while (!release) await new Promise(resolve => setTimeout(resolve, 1));
  loop.enqueue('原木已够，按原任务送回');
  assert.equal(client.messages.length, 1);
  release();
  await setImmediate();
  assert.equal(client.messages.length, 2);
  assert.match(client.messages[1], /按原任务送回/);
  assert.equal(logs.filter(e => e.type === 'recovery_scheduled').length, 1);
  client.complete();
  await loop.stop();
});

test('a pause cancels pending recovery and preserves the latest control', async () => {
  const { client, loop } = create();
  loop.options.retryDelays = [1000, 1000];
  loop.enqueue('砍木头');
  await setImmediate();
  client.complete('conv-1', 'ERROR', 'connection closed');
  await loop.interrupt('玩家暂停', false);
  assert.equal(client.interruptions, 0);
  assert.equal(client.messages.length, 1);
  loop.enqueue('玩家要求继续原任务');
  await setImmediate();
  assert.match(client.messages[1], /玩家暂停/);
  assert.match(client.messages[1], /继续原任务/);
  await loop.stop();
});

test('fresh terminal failures receive two recovery attempts before dispatch handoff', async () => {
  const { client, loop, logs } = create();
  loop.options.retryDelays = [0, 0];
  loop.enqueue('继续采集');
  await setImmediate();
  for (let n = 0; n < 3; n++) {
    client.emit('step_update', { conversation_id: 'conv-1', step_index: n * 2,
      step_type: 'error_message', state: 'DONE' });
    client.complete('conv-1', 'ERROR', 'INTERNAL (code 500)');
    if (n < 2) while (client.messages.length < n + 2) await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.equal(client.interruptions, 2);
  assert.equal(client.messages.length, 3);
  assert.equal(logs.findLast(e => e.type === 'turn_blocked').reason, 'retry_limit');
  await loop.stop();
});
