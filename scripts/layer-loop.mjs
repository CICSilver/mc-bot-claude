import { EventEmitter } from 'node:events';
import { normalizeMcpTool } from './agy-config.mjs';
import { makeStepUsage, stepIdentity } from './telemetry.mjs';

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
    this.telemetryModel = options.model;
    this.lastLoggedConversationId = this.threadId;
    this.loggedStepTelemetry = new Map();

    this.onInit = msg => this.handleInit(msg);
    this.onStepUpdate = step => this.handleStepUpdate(step);
    this.onResult = res => this.handleResult(res);
    this.onProcessStarted = info => this.log({ type: 'agy_process_started', ...info });
    this.onNotification = msg => {
      if (!['init', 'step_update', 'result'].includes(msg?.event)) {
        this.log({ type: 'agy_event', conversationId: msg?.conversation_id ?? this.threadId,
          turnId: this.active, data: msg });
      }
    };

    client.on('init', this.onInit);
    client.on('step_update', this.onStepUpdate);
    client.on('result', this.onResult);
    client.on('process_started', this.onProcessStarted);
    client.on('notification', this.onNotification);
    if (client.lastProcessStart) this.onProcessStarted(client.lastProcessStart);
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
    this.log({ type: 'session_changed', previousConversationId: this.lastLoggedConversationId,
      conversationId: id, turnId: this.active });
    this.lastLoggedConversationId = id;
    this.threadId = id;
    this.emit('session', id);
  }

  handleInit(msg = {}) {
    this.updateSessionId(msg.conversation_id);
    this.telemetryModel = msg.init?.model ?? this.options.model;
    this.log({ type: 'agy_init', conversationId: msg.conversation_id ?? this.threadId,
      model: this.telemetryModel, init: msg.init ?? null });
  }

  logStepTelemetry(record) {
    const identity = stepIdentity(record);
    if (identity) {
      const key = `${record.type}:${identity}:${record.state}`;
      const fingerprint = JSON.stringify(record);
      if (this.loggedStepTelemetry.get(key) === fingerprint) return;
      this.loggedStepTelemetry.set(key, fingerprint);
    }
    this.log(record);
  }

  handleStepUpdate(step = {}) {
    this.updateSessionId(step.conversation_id);
    const terminal = ['DONE', 'ERROR', 'FAILED'].includes(step.state);
    const identity = { conversationId: step.conversation_id ?? this.threadId,
      turnId: this.active, model: this.telemetryModel };
    // Capture final usage before text/tool branches return, including empty replies.
    if (terminal && (step.usage || step.step_type === 'agent_response')) {
      this.logStepTelemetry(makeStepUsage(step, identity));
    }
    if (step.step_type === 'checkpoint' && (terminal || step.state === 'ACTIVE')) {
      this.logStepTelemetry({ type: 'checkpoint', ...identity, stepIndex: step.step_index ?? null,
        state: step.state, nativeStep: step });
    } else if (terminal && !['agent_response', 'tool', 'user_input'].includes(step.step_type)) {
      this.logStepTelemetry({ type: 'agy_step', ...identity, stepIndex: step.step_index ?? null,
        state: step.state, nativeStep: step });
    }
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
      const isDone = step.state === 'DONE' || step.state === 'ERROR' || step.state === 'FAILED';
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
          inputTokens: u.input_tokens ?? null,
          cachedInputTokens: u.cache_read_tokens ?? null,
          outputTokens: u.output_tokens ?? null,
          reasoningOutputTokens: u.thinking_tokens ?? null,
          totalTokens: u.total_tokens ?? null,
        },
      };
      this.log({ type: 'usage', conversationId: res.conversation_id ?? this.threadId,
        turnId: this.active, usageScope: 'conversation', tokenUsage, rawUsage: u,
        numTurns: res.num_turns ?? null, durationSeconds: res.duration_seconds ?? null });
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
      this.consecutiveFailures = (this.consecutiveFailures ?? 0) + 1;
      const isSafety = /content safety filters|Prohibited Use policy/i.test(errorObj.message);
      const shortErr = errorObj.message.split('\n')[0];
      console.warn(`\n⚠️ [本轮模型输出中断 (${this.consecutiveFailures})]: ${shortErr}`);
      // 如果是安全过滤拦截或连续两次回合失败，重启或切换干净会话继续监听，不直接关窗下线
      if (isSafety || this.consecutiveFailures >= 2) {
        const resetThread = isSafety && this.consecutiveFailures >= 2;
        if (resetThread) {
          this.log({ type: 'conversation_reset_requested', conversationId: this.threadId,
            turnId, reason: 'content_safety', consecutiveFailures: this.consecutiveFailures });
          console.warn('⚠️ 连续触发内容安全过滤，自动开启新会话线程以清除历史拦截状态…');
          this.threadId = null;
        }
        void this.client.interrupt(resetThread).then(() => {
          void this.pump();
        });
      } else {
        void this.pump();
      }
    } else {
      this.consecutiveFailures = 0;
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
    this.client.off('process_started', this.onProcessStarted);
    this.client.off('notification', this.onNotification);
  }
}
