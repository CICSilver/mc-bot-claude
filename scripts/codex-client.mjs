import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class AppServer extends EventEmitter {
  constructor(executable, args, options = {}) {
    super(); this.pending = new Map(); this.sequence = 0; this.buffer = ''; this.closing = false;
    this.child = spawn(executable, args, { ...options, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8'); this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', data => {
      this.buffer += data.toString(); let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        if (!line.trim()) continue;
        let message; try { message = JSON.parse(line); } catch { this.emit('diagnostic', 'app-server 输出了无效 JSON'); continue; }
        if (message.id !== undefined && !message.method) {
          const pending = this.pending.get(message.id); if (!pending) continue;
          this.pending.delete(message.id); clearTimeout(pending.timer);
          if (message.error) pending.reject(Object.assign(new Error(message.error.message), message.error)); else pending.resolve(message.result);
        } else if (message.id !== undefined) this.denyRequest(message);
        else this.emit('notification', message);
      }
    });
    this.child.stderr.on('data', data => this.emit('diagnostic', data.toString()));
    const failed = error => {
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear(); if (!this.closing) this.emit('fatal', error);
    };
    this.child.on('error', failed);
    this.child.on('exit', code => failed(new Error(`app-server 退出：${code}`)));
  }
  send(message) { if (this.child.stdin.destroyed) throw new Error('app-server 已关闭'); this.child.stdin.write(JSON.stringify(message) + '\n'); }
  request(method, params = {}, timeout = 30000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} 超时`)); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }
  async initialize() {
    const result = await this.request('initialize', { clientInfo: { name: 'mc_bot_codex', title: '小克 Codex', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} }); return result;
  }
  denyRequest(message) {
    let result;
    if (/requestApproval$/.test(message.method)) result = message.method === 'item/permissions/requestApproval' ? { permissions: {}, scope: 'turn' } : { decision: 'decline' };
    else if (message.method === 'mcpServer/elicitation/request') result = { action: 'decline', content: null };
    else if (/requestUserInput$/.test(message.method)) result = { answers: {} };
    else { this.send({ id: message.id, error: { code: -32601, message: '机器人不提供此能力' } }); return; }
    this.send({ id: message.id, result }); this.emit('denied', message.method);
  }
  async close() {
    this.closing = true;
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    await new Promise(resolve => {
      const timer = setTimeout(() => this.child.kill(), 2000);
      this.child.once('exit', () => { clearTimeout(timer); resolve(); });
      this.child.stdin.end();
    });
  }
}

export async function openThread(client, { home, options, profile, threadId }) {
  await client.initialize();
  const skills = await client.request('skills/list', { cwds: [home], forceReload: true });
  for (const entry of skills.data ?? []) for (const skill of entry.skills ?? []) {
    if (skill.enabled !== false) await client.request('skills/config/write', { path: skill.path, enabled: false });
  }
  const params = {
    cwd: home, model: options.model, approvalPolicy: 'never', sandbox: 'danger-full-access',
    baseInstructions: profile.prompt, developerInstructions: '',
    config: { project_doc_max_bytes: 0 }, serviceTier: 'default',
  };
  const result = threadId
    ? await client.request('thread/resume', { ...params, threadId })
    : await client.request('thread/start', { ...params, allowProviderModelFallback: false });
  return result.thread.id;
}
