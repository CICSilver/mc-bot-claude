import { EventEmitter } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
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
    this.stepCursors = new Map();
    this.turnSteps = null;
    this.recoveryAbort = null;
    this.queryCount = 0;
    this.queryStep = null;

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
        this.queryCount = 0;
        this.queryStep = null;
        this.lastInputText = text;
        this.turnMcpTools = 0;
        this.turnInvalidToolError = false;
        this.beginTurnSteps(this.threadId);
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
    this.recoveryAbort?.abort();
    if (this.interrupting) await this.interrupting;
    const turnId = this.active;
    this.active = null;
    this.turnSteps = null;
    this.consecutiveFailures = 0;
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
    if (this.active && this.turnSteps?.conversationId !== id) this.beginTurnSteps(id);
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

  beginTurnSteps(conversationId) {
    this.turnSteps = {
      conversationId, start: this.stepCursors.get(conversationId) ?? -1,
      response: -1, error: -1, pending: new Set(),
    };
  }

  handleStepUpdate(step = {}) {
    this.updateSessionId(step.conversation_id);
    const terminal = ['DONE', 'ERROR', 'FAILED'].includes(step.state);
    const index = step.step_index;
    if (Number.isInteger(index)) {
      const id = step.conversation_id ?? this.threadId;
      this.stepCursors.set(id, Math.max(index, this.stepCursors.get(id) ?? -1));
      const turn = this.turnSteps;
      if (this.active && turn && index > turn.start) {
        if (step.state === 'ACTIVE') turn.pending.add(index);
        if (terminal) turn.pending.delete(index);
        if (step.step_type === 'agent_response' && step.state === 'DONE') turn.response = Math.max(turn.response, index);
        if ((step.step_type === 'error_message' && terminal) || ['ERROR', 'FAILED'].includes(step.state)) {
          turn.error = Math.max(turn.error, index);
        }
      }
    }
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
      if (isDone && /unknown tool/i.test(String(info.error ?? step.error ?? ''))) this.turnInvalidToolError = true;
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
          this.turnMcpTools = (this.turnMcpTools ?? 0) + 1;
        }
        const key = `${step.conversation_id}:${index}`;
        if (isDone && this.active && this.options.layer === 'exec' && info.server === 'minecraft' && key !== this.queryStep) {
          this.queryStep = key;
          if (/^(get-|list-|find-|look-|survey-)/.test(info.tool)) this.queryCount++;
          else if (!/^(murmur|send-chat)$/.test(info.tool)) this.queryCount = 0;
          if (this.queryCount >= 12) {
            const pending = this.queue.join('\n');
            const message = '连续查询已达 12 次，现场信息已收集。请根据已有信息选择具体动作，或将选址交给规划脑。';
            this.log({ type: 'query_yield', turnId: this.active, queryCount: this.queryCount });
            void this.interrupt(pending || message, Boolean(pending)).then(() => {
              if (!pending) this.emit('blocked', message);
            }).catch(error => this.emit('fatal', error));
          }
        }
      }
    }
  }

  handleResult(res = {}) {
    this.updateSessionId(res.conversation_id);
    if (!this.active) {
      this.log({ type: 'unmatched_result', conversationId: this.threadId, rawStatus: res.status, rawError: res.error ?? null });
      return;
    }
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

    const turnId = this.active;
    const steps = this.turnSteps;
    this.active = null;
    this.turnSteps = null;
    const completedTail = steps && steps.response > Math.max(steps.start, steps.error) && steps.pending.size === 0;
    const recovered = res.status !== 'SUCCESS' && completedTail;
    const failed = res.status !== 'SUCCESS' && !recovered;
    const errorObj = failed ? { message: res.error || `模型回合失败 (${res.status})` } : null;
    this.log({
      type: 'turn_completed',
      turnId,
      status: failed ? 'failed' : 'completed',
      error: errorObj,
      rawStatus: res.status,
      rawError: res.error ?? null,
      resultKind: recovered ? (steps.error > steps.start ? 'recovered' : 'historical_error') : failed ? 'failed' : 'success',
      stepStart: steps?.start ?? null,
      lastResponseStep: steps?.response ?? null,
      lastErrorStep: steps?.error ?? null,
    });
    this.emit('activity', failed ? 'StopFailure' : 'Stop', '');

    if (failed) {
      this.consecutiveFailures = (this.consecutiveFailures ?? 0) + 1;
      const isSafety = /content safety filters|Prohibited Use policy/i.test(errorObj.message);
      const shortErr = errorObj.message.split('\n')[0];
      console.warn(`\n⚠️ [本轮模型输出中断 (${this.consecutiveFailures})]: ${shortErr}`);
      if (isSafety || this.consecutiveFailures > 2) {
        this.log({ type: 'turn_blocked', turnId, reason: isSafety ? 'content_safety' : 'retry_limit' });
        this.emit('blocked', isSafety ? '本轮模型返回内容限制，当前任务需要调度处理。' : '本轮连接恢复已尝试两次，当前任务需要调度处理。');
        this.consecutiveFailures = 0;

        void this.pump();
      } else {
        this.recover(this.options.retryDelays?.[this.consecutiveFailures - 1] ?? this.consecutiveFailures * 1000);
      }
    } else {
      this.consecutiveFailures = 0;
      if (this.options.layer === 'exec' && /\[(任务|进展|天气)\]/.test(this.lastInputText ?? '')) {
        if ((this.turnMcpTools ?? 0) === 0 || this.turnInvalidToolError) {
          this.noToolTaskTurns = (this.noToolTaskTurns ?? 0) + 1;
          if (this.turnInvalidToolError || this.noToolTaskTurns >= 2) {
            this.noToolTaskTurns = 0;
            this.resetSession(this.turnInvalidToolError ? 'invalid_tool_call' : 'exec_no_tool_calls');
            return;
          }
        } else {
          this.noToolTaskTurns = 0;
        }
      }
      void this.pump();
    }
  }

  resetSession(reason) {
    this.threadId = null;
    this.lastLoggedConversationId = null;
    this.log({ type: 'session_reset', reason });
    this.interrupting = this.client.interrupt(true).finally(() => {
      this.interrupting = null;
      if (!this.stopped) void this.pump();
    });
  }

  recover(waitMs) {
    const abort = this.recoveryAbort = new AbortController();
    this.log({ type: 'recovery_scheduled', attempt: this.consecutiveFailures, waitMs });
    this.interrupting = (async () => {
      try {
        await delay(waitMs, undefined, { signal: abort.signal });
        await this.client.interrupt();
        if (!abort.signal.aborted && !this.stopped && !this.queue.length) {
          this.queue.push(this.options.recoveryText ?? '连接已经恢复。核对当前任务与已完成的步骤，接着处理剩余工作。');
        }
      } catch (error) {
        if (error.name !== 'AbortError') { this.stopped = true; this.emit('fatal', error); }
      } finally {
        this.interrupting = null;
        this.recoveryAbort = null;
        if (!abort.signal.aborted) void this.pump();
      }
    })();
  }

  async stop() {
    this.stopped = true;
    this.recoveryAbort?.abort();
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
