import { EventEmitter } from 'node:events';

export class LayerLoop extends EventEmitter {
  constructor(client, threadId, options, log = () => {}) {
    super(); this.client = client; this.threadId = threadId; this.options = options; this.log = log;
    this.queue = []; this.active = null; this.draining = false; this.stopped = false; this.completed = new Set();
    this.onNotification = message => this.notification(message);
    client.on('notification', this.onNotification);
  }
  enqueue(text) {
    if (this.stopped) return;
    this.log({ type: 'input', text }); this.queue.push(text); void this.pump();
  }
  async pump() {
    if (this.draining || this.stopped || !this.queue.length) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.stopped) {
        const text = this.queue.splice(0).join('\n');
        const input = [{ type: 'text', text }];
        if (this.active) {
          const expectedTurnId = this.active;
          try {
            await this.client.request('turn/steer', { threadId: this.threadId, expectedTurnId, input });
            this.log({ type: 'steered', turnId: expectedTurnId });
          } catch (error) {
            // 只有确认旧回合结束的冲突才可再次投递；网络错误不能冒险重放。
            if (this.completed.has(expectedTurnId)) { this.queue.unshift(text); this.active = null; }
            else throw error;
          }
        } else {
          const result = await this.client.request('turn/start', {
            threadId: this.threadId, input, model: this.options.model, effort: this.options.effort,
            approvalPolicy: 'never', serviceTierForTurn: 'default',
            collaborationMode: { mode: 'default', settings: { model: this.options.model, reasoning_effort: this.options.effort, developer_instructions: '' } },
          });
          if (!result.turn?.id) throw new Error('turn/start 未返回回合 ID');
          this.active = this.completed.has(result.turn.id) ? null : result.turn.id;
        }
      }
    } catch (error) { this.stopped = true; this.emit('fatal', error); }
    finally { this.draining = false; }
  }
  notification({ method, params = {} }) {
    if (params.threadId && params.threadId !== this.threadId) return;
    if (method === 'turn/started') {
      this.active = params.turn.id; this.log({ type: 'turn_started', turnId: this.active }); this.emit('activity', 'UserPromptSubmit', '');
    } else if (method === 'turn/completed') {
      const turn = params.turn; this.completed.add(turn.id);
      if (this.completed.size > 100) this.completed.delete(this.completed.values().next().value);
      if (this.active === turn.id) this.active = null;
      this.log({ type: 'turn_completed', turnId: turn.id, status: turn.status, error: turn.error ?? null });
      this.emit('activity', turn.status === 'failed' ? 'StopFailure' : 'Stop', '');
      if (turn.status === 'failed') { this.stopped = true; this.emit('fatal', new Error(turn.error?.message ?? '模型回合失败')); }
      else void this.pump();
    } else if (method === 'item/agentMessage/delta') {
      this.log({ type: 'output', turnId: params.turnId, text: params.delta }); this.emit('output', params.delta);
    } else if (method === 'thread/tokenUsage/updated') this.log({ type: 'usage', tokenUsage: params.tokenUsage });
    else if (method === 'account/rateLimits/updated') this.log({ type: 'rate_limits', rateLimits: params });
    else if (method === 'item/started' || method === 'item/completed') {
      const item = params.item ?? {};
      if (item.type === 'mcpToolCall') {
        const tool = item.server === 'files' ? item.tool : `mcp__${item.server}__${item.tool}`;
        this.emit('activity', method.endsWith('started') ? 'PreToolUse' : 'PostToolUse', tool);
        this.log({ type: method.endsWith('started') ? 'tool_started' : 'tool_completed', turnId: params.turnId, server: item.server, tool: item.tool, arguments: item.arguments, result: item.result, error: item.error });
      }
    }
  }
  async stop() {
    this.stopped = true; this.queue.length = 0;
    if (this.active) await this.client.request('turn/interrupt', { threadId: this.threadId, turnId: this.active }, 5000).catch(() => {});
    this.emit('activity', 'Stop', ''); this.client.off('notification', this.onNotification);
  }
}
