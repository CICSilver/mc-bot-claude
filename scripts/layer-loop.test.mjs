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
