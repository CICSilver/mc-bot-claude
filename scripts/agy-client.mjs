import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class AgyClient extends EventEmitter {
  constructor(executable, args, options = {}) {
    super();
    this.buffer = '';
    this.closing = false;
    this.conversationId = options.conversationId ?? null;
    this.executable = executable;
    this.args = args;
    this.options = options;
    this.startProcess();
  }

  startProcess(reason = 'initial') {
    this.buffer = '';
    const args = this.args.filter((arg, i, all) => arg !== '--conversation' && all[i - 1] !== '--conversation');
    if (this.conversationId) args.push('--conversation', this.conversationId);
    const child = this.child = spawn(this.executable, args, {
      ...this.options,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.lastProcessStart = {
      processSequence: (this.lastProcessStart?.processSequence ?? 0) + 1,
      pid: child.pid ?? null,
      conversationId: this.conversationId,
      reason,
    };
    this.emit('process_started', this.lastProcessStart);
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');

    this.child.stdout.on('data', data => {
      if (child !== this.child) return;
      this.buffer += data.toString();
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end).trim();
        this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          this.emit('diagnostic', `agy 输出了非 JSON 行: ${line}\n`);
          continue;
        }
        this.handleMessage(message);
      }
    });

    this.child.stderr.on('data', data => {
      this.emit('diagnostic', data.toString());
    });

    const failed = error => {
      if (!this.closing && child === this.child) this.emit('fatal', error);
    };
    this.child.on('error', failed);
    this.child.on('exit', code => {
      if (!this.closing && child === this.child && code !== 0) {
        this.restartCount = (this.restartCount ?? 0) + 1;
        if (this.restartCount <= 3) {
          this.emit('diagnostic', `agy 进程异常退出 (${code})，正在自动拉起 (${this.restartCount}/3)…\n`);
          setTimeout(() => {
            if (!this.closing && child === this.child) this.startProcess('unexpected_exit');
          }, 1000);
          return;
        }
        failed(new Error(`agy 进程退出：${code}`));
      }
    });
  }

  async interrupt(resetConversation = false) {
    if (resetConversation) this.conversationId = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    }
    if (!this.closing) this.startProcess(resetConversation ? 'conversation_reset' : 'interrupt_resume');
  }

  handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.event === 'init') {
      if (message.conversation_id) this.conversationId = message.conversation_id;
      this.emit('init', message);
    } else if (message.event === 'step_update' && message.step_update) {
      if (message.step_update.conversation_id) this.conversationId = message.step_update.conversation_id;
      this.emit('step_update', message.step_update);
    } else if (message.event === 'result' && message.result) {
      if (message.result.conversation_id) this.conversationId = message.result.conversation_id;
      this.emit('result', message.result);
    }
    this.emit('notification', message);
  }

  send(payload) {
    if (this.child.stdin.destroyed) throw new Error('agy 输入流已关闭');
    this.child.stdin.write(JSON.stringify(payload) + '\n');
  }

  sendUserMessage(text) {
    this.send({
      event: 'user',
      message: {
        content: String(text),
      },
    });
  }

  async close() {
    this.closing = true;
    if (!this.child) return;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        try { this.child.kill(); } catch {}
      }, 2000);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        this.child.stdin.end();
      } catch {
        clearTimeout(timer);
        resolve();
      }
    });
  }
}
