import { EventEmitter } from 'node:events';
import { normalizeMcpTool } from './agy-config.mjs';

export class LayerLoop extends EventEmitter {
  constructor(client, threadId, options, log = () => {}) {
    super();
    this.client = client;
    this.threadId = threadId ?? client.conversationId ?? null;
    this.options = options;
    this.log = log;
    this.queue = [];
    this.active = null;
    this.draining = false;
    this.stopped = false;
    this.turnSeq = 0;
    this.interruption = '';
    this.interrupting = null;

    this.onInit = msg => this.handleInit(msg);
    this.onStepUpdate = step => this.handleStepUpdate(step);
    this.onResult = res => this.handleResult(res);

    client.on('init', this.onInit);
    client.on('step_update', this.onStepUpdate);
    client.on('result', this.onResult);
  }

  enqueue(text) {
    if (this.stopped) return;
    this.log({ type: 'input', text });
    this.queue.push(text);
    if (this.active) {
      this.log({ type: 'queued', turnId: this.active });
      return;
    }
    void this.pump();
  }

  async pump() {
    if (this.draining || this.stopped || this.active || this.interrupting || !this.queue.length) return;
    this.draining = true;
    try {
      while (this.queue.length && !this.stopped && !this.active) {
        const text = [this.interruption, ...this.queue.splice(0)].filter(Boolean).join('\n');
        this.interruption = '';
        const turnId = `turn-${++this.turnSeq}`;
        this.active = turnId;
        this.log({ type: 'turn_started', turnId });
        this.emit('activity', 'UserPromptSubmit', '');
        await this.client.sendUserMessage(text);
      }
    } catch (error) {
      this.active = null;
      this.stopped = true;
      this.emit('fatal', error);
    } finally {
      this.draining = false;
    }
  }

  async interrupt(text, resume = true) {
    if (this.stopped) return;
    if (this.interrupting) await this.interrupting;
    const turnId = this.active;
    this.active = null;
    this.queue.length = 0;
    this.interruption = `（最新控制要求）${text}`;
    this.log({ type: 'turn_interrupted', turnId, text, resume });
    this.emit('activity', 'Stop', '');
    if (turnId) {
      this.interrupting = this.client.interrupt();
      try { await this.interrupting; }
      finally { this.interrupting = null; }
    }
    if (resume) this.enqueue('请按最新控制要求处理。');
    else void this.pump();
  }

  updateSessionId(id) {
    if (!id || id === this.threadId) return;
    this.threadId = id;
    this.emit('session', id);
  }

  handleInit(msg = {}) {
    this.updateSessionId(msg.conversation_id);
  }

  handleStepUpdate(step = {}) {
    this.updateSessionId(step.conversation_id);
    if (step.step_type === 'agent_response' && step.text_delta) {
      this.log({ type: 'output', turnId: this.active, text: step.text_delta });
      this.emit('output', step.text_delta);
      return;
    }
    if (step.step_type === 'tool') {
      const info = normalizeMcpTool(step);
      // 忽略 Agy 内部自动读取 ~/.gemini/antigravity-cli/(mcp|brain)/... 的 schema 预检或长输出缓存步骤
      if (!info.isMcp && info.tool === 'view_file') {
        const targetPath = String(info.arguments?.AbsolutePath ?? '');
        if (/antigravity-cli[\\/](mcp|brain)[\\/]/i.test(targetPath)) return;
        info.server = 'files';
        info.tool = 'Read';
        info.arguments = { path: targetPath };
        info.hookTool = 'Read';
      }
      const isStart = step.state === 'ACTIVE';
      const isDone = step.state === 'DONE';
      if (!isStart && !isDone) return;

      this.emit('activity', isStart ? 'PreToolUse' : 'PostToolUse', info.hookTool);
      if (info.isMcp || info.server === 'files') {
        this.log({
          type: isStart ? 'tool_started' : 'tool_completed',
          turnId: this.active,
          server: info.server,
          tool: info.tool,
          arguments: info.arguments,
          ...(isDone ? { result: info.result, error: info.error } : {}),
        });
        if (isStart) {
          this.emit('tool', info);
        }
      }
    }
  }

  handleResult(res = {}) {
    this.updateSessionId(res.conversation_id);
    if (res.usage) {
      const u = res.usage;
      const tokenUsage = {
        total: {
          inputTokens: u.input_tokens ?? 0,
          cachedInputTokens: u.cache_read_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          reasoningOutputTokens: u.thinking_tokens ?? 0,
          totalTokens: u.total_tokens ?? 0,
        },
      };
      this.log({ type: 'usage', tokenUsage });
    }

    const turnId = this.active ?? `turn-${++this.turnSeq}`;
    this.active = null;
    const failed = res.status !== 'SUCCESS';
    const errorObj = failed ? { message: res.error || `模型回合失败 (${res.status})` } : null;
    this.log({
      type: 'turn_completed',
      turnId,
      status: failed ? 'failed' : 'completed',
      error: errorObj,
    });
    this.emit('activity', failed ? 'StopFailure' : 'Stop', '');

    if (failed) {
      this.stopped = true;
      this.emit('fatal', new Error(errorObj.message));
    } else {
      void this.pump();
    }
  }

  async stop() {
    this.stopped = true;
    this.queue.length = 0;
    this.active = null;
    this.emit('activity', 'Stop', '');
    this.client.off('init', this.onInit);
    this.client.off('step_update', this.onStepUpdate);
    this.client.off('result', this.onResult);
  }
}
