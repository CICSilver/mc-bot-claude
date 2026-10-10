import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { ROOT } from './codex-config.mjs';

export function loadLogs(args) {
  const logs = join(ROOT, 'logs'), runs = join(logs, 'runs');
  if (args.includes('--list')) {
    console.log(existsSync(runs) ? readdirSync(runs).join('\n') : '尚无归档');
    return [];
  }
  const targets = args.length ? args.map(p => resolve(p)) : [logs];
  const result = [];
  for (const target of targets) {
    if (!existsSync(target)) { console.log('尚无记录：' + target); continue; }
    const files = statSync(target).isDirectory()
      ? ['fast', 'exec', 'mind'].map(layer => join(target, layer + '.jsonl')).filter(existsSync) : [target];
    for (const file of files) {
      let entries = readFileSync(file, 'utf8').split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      if (!args.length) {
        const start = entries.findLastIndex(e => e.type === 'session');
        if (start >= 0) entries = entries.slice(start);
      }
      result.push({ name: basename(file, '.jsonl'), entries });
    }
  }
  return result;
}
