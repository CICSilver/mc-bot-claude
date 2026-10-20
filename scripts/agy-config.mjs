import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildToolGuide } from './tool-guide.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const AGY_RUNTIME = join(ROOT, '.runtime', 'layers');
export const DEFAULTS = {
  fast: { model: 'gemini-3.8-flash', effort: 'low' },
  exec: { model: 'gemini-3.8-flash', effort: 'medium' },
  mind: { model: 'gemini-4-argon', effort: 'low' },
  planner: { model: 'gemini-4-argon', effort: 'medium' },
};

export function normalizeModel(model) {
  return String(model ?? '').trim().replace(/-(low|medium|high|xhigh|max)$/i, '');
}

export function findAgy() {
  const exe = process.platform === 'win32' ? 'agy.exe' : 'agy';
  const candidates = [];
  if (process.env.XIAOKE_AGY_BIN) candidates.push(process.env.XIAOKE_AGY_BIN);
  for (const dir of (process.env.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean)) {
    candidates.push(join(dir, exe));
  }
  if (process.env.LOCALAPPDATA) candidates.push(join(process.env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'));
  const userHome = process.env.USERPROFILE || process.env.HOME;
  if (userHome) {
    candidates.push(join(userHome, 'AppData', 'Local', 'agy', 'bin', 'agy.exe'));
    candidates.push(join(userHome, '.local', 'bin', exe));
  }
  const found = candidates.find(p => p && existsSync(p));
  if (!found) throw new Error('找不到 agy 可执行文件，请先安装 Antigravity CLI。');
  return found;
}

export function childEnv(extra = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(CODEX_|OPENAI_|ANTHROPIC_|CLAUDE)/.test(key))
  );
  return { ...env, ...extra };
}

export function layerOptions(layer, config = {}) {
  if (!DEFAULTS[layer]) throw new Error('未知层');
  const value = key =>
    process.env[`XIAOKE_${layer.toUpperCase()}_${key.toUpperCase()}`] ||
    config.layers?.[layer]?.[key] ||
    DEFAULTS[layer][key];
  const rawModel = value('model');
  const effort = value('effort');
  return { model: normalizeModel(rawModel), effort };
}

export function unwrapMcpArguments(raw) {
  let cur = raw;
  for (let i = 0; i < 4; i++) {
    if (typeof cur === 'string') {
      try { cur = JSON.parse(cur); } catch { break; }
    }
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      if ('Arguments' in cur && ('ServerName' in cur || 'ToolName' in cur || Object.keys(cur).length === 1)) {
        cur = cur.Arguments;
        continue;
      }
      return cur;
    }
    break;
  }
  return (cur && typeof cur === 'object' && !Array.isArray(cur)) ? cur : {};
}

export function normalizeMcpTool(stepUpdate = {}) {
  const toolName = stepUpdate.tool_name || stepUpdate.tool_info?.name || '';
  const params = stepUpdate.tool_info?.parameters ?? {};
  const output = stepUpdate.tool_info?.output;
  const error = stepUpdate.tool_info?.error ?? null;
  if (toolName === 'call_mcp_tool') {
    const rawServer = String(params.ServerName ?? '');
    const server = rawServer.replace(/_(fast|exec|mind|planner)$/, '') || rawServer;
    const tool = String(params.ToolName ?? '');
    const args = unwrapMcpArguments(params.Arguments ?? {});
    const isError = Boolean(error) || (typeof output === 'string' && /^MCP error|error:/i.test(output.trim()));
    return {
      isMcp: true,
      server,
      rawServer,
      tool,
      arguments: args,
      hookTool: server === 'files' ? tool : `mcp__${server}__${tool}`,
      result: output !== undefined ? { content: [{ type: 'text', text: String(output) }], isError } : null,
      error,
    };
  }
  return {
    isMcp: false,
    server: 'builtin',
    rawServer: 'builtin',
    tool: toolName,
    arguments: params,
    hookTool: toolName,
    result: output !== undefined ? { content: [{ type: 'text', text: String(output) }], isError: Boolean(error) } : null,
    error,
  };
}

function linkDirIfPresent(target, linkPath) {
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink()) unlinkSync(linkPath);
    else return;
  } catch {}
  if (!existsSync(target)) return;
  try {
    symlinkSync(target, linkPath, 'junction');
  } catch {}
}

export function ensureRuntime() {
  mkdirSync(AGY_RUNTIME, { recursive: true });
}

export function makeProfile({ layer, home, promptFile, bodyUrl, options, conversationId, enableMinecraftMcp = true }) {
  if (!DEFAULTS[layer]) throw new Error(`未知层: ${layer}`);
  const prompt = readFileSync(promptFile, 'utf8');
  if (!prompt.trim()) throw new Error('提示词为空，拒绝使用默认提示词。');

  const resolvedHome = resolve(home);
  const layerCwd = join(AGY_RUNTIME, layer);
  const agentsDir = join(layerCwd, '.agents', 'agents');
  mkdirSync(agentsDir, { recursive: true });
  mkdirSync(join(resolvedHome, 'buildings'), { recursive: true });
  mkdirSync(join(resolvedHome, 'state'), { recursive: true });

  for (const sub of ['memory', 'buildings', 'state', '手册', '参考']) {
    linkDirIfPresent(join(resolvedHome, sub), join(layerCwd, sub));
  }
  if (!existsSync(join(resolvedHome, '手册'))) {
    linkDirIfPresent(join(ROOT, 'prompts', '系统', '手册'), join(layerCwd, '手册'));
  }
  if (!existsSync(join(resolvedHome, '参考'))) {
    linkDirIfPresent(join(ROOT, 'prompts', '小克', '参考'), join(layerCwd, '参考'));
  }
  linkDirIfPresent(join(ROOT, 'prompts'), join(layerCwd, 'prompts'));

  const mcpServers = {
    [`files_${layer}`]: {
      command: process.execPath,
      args: [join(ROOT, 'scripts', 'file-tools.mjs'), layer, resolvedHome],
    },
  };
  if (enableMinecraftMcp && bodyUrl) {
    mcpServers[`minecraft_${layer}`] = {
      serverUrl: `${bodyUrl.replace(/\/+$/, '')}/mcp/${layer}`,
    };
  }
  const mcpConfigPath = join(layerCwd, '.agents', 'mcp_config.json');
  writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2));

  const agentName = `xiaoke-${layer}`;
  const roleLabel = { fast: '小克快速反应层', exec: '小克执行脑', mind: '小克轻型调度脑', planner: '小克重型规划脑' }[layer];
  const agyToolGuide = buildToolGuide(layer);

  const agentFile = join(agentsDir, `${agentName}.md`);
  const agentDoc = [
    '---',
    `name: ${agentName}`,
    `description: ${roleLabel}`,
    'mainAgent: true',
    'subagent: false',
    'commandExecutionPolicy: off',
    '---',
    '',
    prompt.trim(),
    '',
    agyToolGuide,
    '',
  ].join('\n');
  writeFileSync(agentFile, agentDoc);

  const model = normalizeModel(options.model);
  const args = [
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
    '--agent', agentName,
    '--model', model,
    '--effort', options.effort,
    ...(conversationId ? ['--conversation', conversationId] : []),
  ];

  return {
    args,
    prompt,
    layerCwd,
    mcpConfigPath,
    agentFile,
    agentName,
  };
}
