import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { LayerLoop } from './layer-loop.mjs';

class Client extends EventEmitter {
  calls = [];
  async request(method, params) {
    this.calls.push({ method, params });
    return this.respond?.(method, params) ?? { turn: { id: 'first' } };
  }
  complete(id) { this.emit('notification', { method: 'turn/completed', params: { threadId: 'thread', turn: { id, status: 'completed' } } }); }
}
const create = () => {
  const client = new Client();
  return { client, loop: new LayerLoop(client, 'thread', { model: 'test', effort: 'low' }) };
};

test('a new game event steers the running turn without starting another', async () => {
  const { client, loop } = create();
  loop.enqueue('玩家打招呼'); await setImmediate();
  loop.enqueue('玩家又递来一条鱼'); await setImmediate();
  assert.deepEqual(client.calls.map(c => c.method), ['turn/start', 'turn/steer']);
  assert.equal(client.calls[1].params.expectedTurnId, 'first');
  assert.equal(client.calls[1].params.input[0].text, '玩家又递来一条鱼');
  client.complete('first');
  assert.equal(loop.active, null);
  await loop.stop();
});

test('completion arriving before turn/start response does not leave the layer busy', async () => {
  const { client, loop } = create();
  client.respond = () => { client.complete('first'); return { turn: { id: 'first' } }; };
  loop.enqueue('查看状态'); await setImmediate();
  assert.equal(loop.active, null);
  await loop.stop();
});

test('an event at the end of a turn is delivered once to the next turn', async () => {
  const { client, loop } = create();
  loop.enqueue('先查看背包'); await setImmediate();
  client.respond = method => {
    if (method === 'turn/steer') { client.complete('first'); throw new Error('旧回合已经结束'); }
    return { turn: { id: 'second' } };
  };
  loop.enqueue('接着看看身旁'); await setImmediate();
  assert.deepEqual(client.calls.map(c => c.method), ['turn/start', 'turn/steer', 'turn/start']);
  assert.equal(client.calls[2].params.input[0].text, '接着看看身旁');
  assert.equal(loop.active, 'second');
  assert.equal(loop.queue.length, 0);
  await loop.stop();
  assert.equal(client.calls.at(-1).method, 'turn/interrupt');
});
